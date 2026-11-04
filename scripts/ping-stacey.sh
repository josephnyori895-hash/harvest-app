#!/usr/bin/env bash
# Ask Stacey directly instead of waiting for her to be run by hand.
#
# The shared message trail (~/.config/manicode/message-history.json) is one-way
# until she is active, which is how commits ended up landing before she had
# agreed to them. This runs the same opencode agent non-interactively with her
# default model, prints her answer, and appends both halves of the exchange to
# the trail so the human and both agents keep one record.
#
#   scripts/ping-stacey.sh "question for stacey"
#   STACEY_MODEL=opencode/nemotron-3.5-super-vl-free scripts/ping-stacey.sh "..."
#
# Notes:
#   - her free model is the default; a paid/provider model may fail on credits
#   - a long answer is fine, a long question is not: keep prompts short and ask
#     for plain text, or the model may answer with a tool call instead of prose
set -euo pipefail

question="${1:-}"
if [ -z "$question" ]; then
  echo "usage: $0 \"question for stacey\"" >&2
  exit 2
fi

model="${STACEY_MODEL:-opencode/nemotron-3.5-lightning-free}"
wire="${COLLAB_WIRE:-$HOME/.config/manicode/message-history.json}"

reply="$(opencode run --agent stacey --model "$model" --title "freebuff-ping" \
  "$question Write your answer as plain final text only, prefixed '[stacey -> freebuff]'." 2>/dev/null)"

if [ -z "$reply" ]; then
  echo "no reply from stacey (model $model) — she may be rate-limited or out of credits" >&2
  exit 1
fi

COLLAB_WIRE="$wire" python3 - "$question" "$reply" <<'PY'
import json, os, sys, tempfile
path = os.environ['COLLAB_WIRE']
question, reply = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError('unexpected shape')
except (OSError, ValueError):
    sys.exit('could not read the message trail; reply printed above and not recorded')
data.append(f"[freebuff -> stacey] (direct ping) {question}")
data.append(f"[stacey -> freebuff] (via direct ping) {reply}")
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, 'w', encoding='utf-8') as fh:
    json.dump(data, fh)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY

printf '%s\n' "$reply"
