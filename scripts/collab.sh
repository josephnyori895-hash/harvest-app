#!/usr/bin/env bash
# Continuous channel to Stacey.
#
# Why this replaces `opencode run` pings: every CLI spawn built a FRESH context,
# so she re-learned the project each time (~40s) and forgot the last exchange.
# The opencode server at `opencode service status` holds real sessions, so one
# long-lived session gives us:
#   * continuity   — she remembers what we agreed, like a person would
#   * speed        — a reply lands in seconds, not the cost of a cold start
#   * no stall     — a prompt sent while she is busy is queued, not lost
#
# Commands:
#   ./scripts/collab.sh init            create (or reuse) the session
#   ./scripts/collab.sh say "..."       send, wait, print her reply
#   ./scripts/collab.sh send "..."      send only, do not wait
#   ./scripts/collab.sh wait [secs]     wait for the pending turn, print reply
#   ./scripts/collab.sh status          is she busy, and what did she say last
#   ./scripts/collab.sh tail [n]        the last n exchanges, newest last
#   ./scripts/collab.sh reset           forget the session (new thread)
#   ./scripts/collab.sh queue "..."     add a task to her queue
#   ./scripts/collab.sh pump            work through the queue, one turn each
#
# `pump` is how she stays busy while I am deep in a change: I queue the jobs I
# want done, run pump in the background, and read .collab/wire.log when I look
# up. She is never mid-nothing — either she is thinking, or the queue is empty.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${COLLAB_DIR:-$ROOT/.collab}"
SESSFILE="$STATE/session"
LOG="$STATE/wire.log"
HISTORY="${COLLAB_HISTORY:-$HOME/.config/manicode/message-history.json}"

AGENT="${STACEY_AGENT:-stacey}"
PROVIDER="${STACEY_PROVIDER:-opencode}"
MODEL="${STACEY_MODEL:-nemotron-3.5-lightning-free}"

mkdir -p "$STATE" && chmod 700 "$STATE"

die() { printf 'collab: %s\n' "$1" >&2; exit 1; }

api() { timeout "${COLLAB_API_TIMEOUT:-60}" opencode api "$@" 2>&1; }

session_id() { [ -s "$SESSFILE" ] && cat "$SESSFILE"; }

# The service must be up; start it if the user has never run opencode serve.
service_url() {
  local url
  url="$(opencode service status 2>/dev/null | head -1 | tr -d '[:space:]')"
  if [ -z "$url" ]; then
    opencode service start >/dev/null 2>&1
    sleep 2
    url="$(opencode service status 2>/dev/null | head -1 | tr -d '[:space:]')"
  fi
  printf '%s' "$url"
}

json_text() { python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$1"; }

# Her turns, in order, printed as text. $1 = session, $2 = how many assistant
# turns already existed (skip those). Message lists come newest-first, so we
# reverse to chronological. We track POSITION, not timestamps: a turn's
# `created` is when it STARTED, which can be earlier than the moment we begin
# waiting, and a time filter silently drops exactly the reply we want.
reply_since() {
  local sid="$1" skip="${2:-0}"
  api GET "/api/session/$sid/message" | SKIP="$skip" python3 -c '
import json, os, sys
skip = int(os.environ.get("SKIP") or 0)
try:
    rows = json.load(sys.stdin)["data"]
except Exception:
    sys.exit(0)
turns = [m for m in rows if m.get("type") == "assistant"]
turns.reverse()
out = []
for m in turns[skip:]:
    for part in m.get("content") or []:
        if part.get("type") == "text" and (part.get("text") or "").strip():
            out.append(part["text"].strip())
print("\n".join(out))
'
}

assistant_count() {
  api GET "/api/session/$1/message" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)["data"]
except Exception:
    print(0); raise SystemExit
print(sum(1 for m in rows if m.get("type") == "assistant"))
'
}

cmd_init() {
  local sid
  sid="$(session_id)"
  if [ -n "$sid" ] && api GET "/api/session/$sid" | grep -q '"agent"'; then
    printf 'collab: reusing session %s\n' "$sid"
    return 0
  fi
  sid="$(api POST /api/session -d "$(python3 -c 'import json;print(json.dumps({"title":"harvest-collab","agent":"'"$AGENT"'"}))')" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')" || die "could not create a session"
  [ -n "$sid" ] || die "session create returned nothing"
  # A session is created in the server's cwd; she must work in the repo.
  api POST "/api/session/$sid/move" -d "$(python3 -c 'import json,sys; print(json.dumps({"directory": sys.argv[1]}))' "$ROOT")" >/dev/null
  api POST "/api/session/$sid/model" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"model":{"providerID":sys.argv[1],"id":sys.argv[2]}}))' "$PROVIDER" "$MODEL")" >/dev/null
  printf '%s\n' "$sid" > "$SESSFILE"
  chmod 600 "$SESSFILE"
  printf 'collab: session %s in %s on %s/%s\n' "$sid" "$ROOT" "$PROVIDER" "$MODEL"
}

do_send() {
  local sid text
  sid="$(session_id)"; [ -n "$sid" ] || { cmd_init >/dev/null; sid="$(session_id)"; }
  text="$1"
  service_url >/dev/null
  api POST "/api/session/$sid/prompt" -d "$(json_text "$text")" | grep -q '"id"' \
    || die "prompt was rejected by the server"
  printf '[freebuff -> stacey] %s\n' "$text" >> "$LOG"
  [ -f "$HISTORY" ] && python3 - "$HISTORY" "[freebuff -> stacey] $text" <<'PY' 2>/dev/null
import json, os, sys, tempfile
path, line = sys.argv[1], sys.argv[2]
try:
    rows = json.load(open(path, encoding="utf-8"))
    if not isinstance(rows, list): rows = []
except Exception:
    rows = []
rows.append(line)
rows = rows[-1000:]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(rows, fh, indent=2)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
  printf 'collab: sent (%s chars)\n' "${#text}"
}

do_wait() {
  local sid skip="${1:-0}" limit="${2:-240}" deadline reply
  sid="$(session_id)"; [ -n "$sid" ] || die "no session yet — run: collab.sh init"
  deadline=$(( $(date +%s) + limit ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    reply="$(reply_since "$sid" "$skip")"
    if [ -n "$reply" ]; then
      printf '%s\n' "$reply"
      printf '[stacey -> freebuff] %s\n' "$reply" >> "$LOG"
      return 0
    fi
    sleep 3
  done
  printf 'collab: no reply within %ss (session %s)\n' "$limit" "$sid" >&2
  return 1
}

cmd_status() {
  local sid
  sid="$(session_id)"
  [ -n "$sid" ] || { printf 'collab: no session (url %s)\n' "$(service_url)"; return 1; }
  api GET "/api/session/$sid" | python3 -c '
import json, sys
d = json.load(sys.stdin).get("data") or {}
t = d.get("time") or {}
print("session :", d.get("id"))
print("agent   :", d.get("agent"), "| model:", (d.get("model") or {}).get("id"))
print("in      :", (d.get("location") or {}).get("directory"))
print("state   :", "working" if t.get("busy") and not t.get("idle") else ("idle" if t.get("idle") else "new"))
tok = d.get("tokens") or {}
print("tokens  :", tok.get("input"), "in /", tok.get("output"), "out")
'
  printf -- '--- last thing she said ---\n'
  reply_since "$sid" 0 | tail -12
}

cmd_tail() { tail -n "${1:-40}" "$LOG" 2>/dev/null || printf 'collab: no log yet\n'; }

cmd_queue() {
  local dir="$STATE/queue"
  mkdir -p "$dir"
  local n
  n=$(printf '%04d' $(( $(ls -1 "$dir" 2>/dev/null | wc -l) + 1 )))
  printf '%s\n' "$1" > "$dir/$n.txt"
  printf 'collab: queued %s\n' "$n"
}

cmd_pump() {
  local dir="$STATE/queue" done_n=0 f text
  mkdir -p "$dir"
  while :; do
    f="$(ls -1 "$dir"/*.txt 2>/dev/null | head -1)"
    [ -n "$f" ] || break
    text="$(cat "$f")"
    rm -f "$f"
    printf 'collab: pumping %s\n' "$(basename "$f")"
    base="$(assistant_count "$(session_id)")"
    do_send "$text" >/dev/null || { printf 'collab: send failed, requeueing %s\n' "$(basename "$f")" >&2; printf '%s\n' "$text" > "$f"; break; }
    do_wait "$base" "${COLLAB_WAIT:-240}" >/dev/null || printf 'collab: no reply for %s\n' "$(basename "$f")" >&2
    done_n=$((done_n + 1))
    sleep "${COLLAB_GAP:-2}"
  done
  printf 'collab: pumped %d item(s)\n' "$done_n"
}

cmd_reset() { rm -f "$SESSFILE"; printf 'collab: session forgotten — next send starts a new thread\n'; }

[ $# -ge 1 ] || { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

case "$1" in
  init)   cmd_init ;;
  send)   shift; [ $# -ge 1 ] || die "send needs text"; do_send "$*" ;;
  say)    shift; [ $# -ge 1 ] || die "say needs text"
          base="$(assistant_count "$(session_id)")"
          do_send "$*" >/dev/null && do_wait "$base" "${COLLAB_WAIT:-240}" ;;
  wait)   shift; do_wait 0 "${1:-240}" ;;
  status) cmd_status ;;
  queue)  shift; [ $# -ge 1 ] || die "queue needs text"; cmd_queue "$*" ;;
  pump)   cmd_pump ;;
  tail)   shift; cmd_tail "$@" ;;
  reset)  cmd_reset ;;
  *)      die "unknown command: $1 (init | say | send | wait | status | tail | reset)" ;;
esac
