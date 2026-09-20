// Provisions Cloudflare resources and writes real ids into wrangler.toml.
// Usage: CLOUDFLARE_API_TOKEN=xxx node scripts/provision.mjs
// Steps: d1 create → r2 create → patch wrangler.toml → print next steps.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tomlPath = path.join(root, 'wrangler.toml')

function run(cmd) {
  console.log(`$ ${cmd}`)
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function readToml() {
  return fs.readFileSync(tomlPath, 'utf8')
}

function writeToml(content) {
  fs.writeFileSync(tomlPath, content)
}

let toml = readToml()

// 1) D1
if (toml.includes('PLACEHOLDER_RUN_D1_CREATE')) {
  try {
    const out = run('npx wrangler d1 create harvestfamily')
    const id = out.match(/database_id\s*=\s*"([0-9a-f-]+)"/i)?.[1] || out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
    if (!id) throw new Error('could not parse database_id from wrangler output')
    toml = toml.replace('PLACEHOLDER_RUN_D1_CREATE', id)
    writeToml(toml)
    console.log(`✔ D1 database created: ${id}`)
  } catch (e) {
    console.error('✘ D1 create failed — if the database already exists, run:')
    console.error("  npx wrangler d1 info harvestfamily  # then paste database_id into wrangler.toml")
    process.exitCode = 1
  }
} else {
  console.log('• D1 already configured')
}

// 2) R2
try {
  run('npx wrangler r2 bucket create harvest-media')
  console.log('✔ R2 bucket ready: harvest-media')
} catch {
  console.log('• R2 bucket create skipped (may already exist)')
}

// 3) Next steps
console.log(`
Next steps:
  1. npx wrangler d1 migrations apply DB --remote          # schema + seed (creates members 'allan' + admin 'harvest')
  2. npx wrangler secret put JWT_SECRET                     # openssl rand -base64 48
  3. REQUIRED for admin bootstrap after security hardening:
       npx wrangler secret put ADMIN_PIN_HASHES              # JSON array of bcrypt hashes for a private 4-6 digit bootstrap PIN
     Never put the PIN or its hash in git. After first login, the account stores a private PBKDF2 credential.
  4. Optional secrets (presigned direct-to-R2 uploads):
       npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
       npx wrangler secret put R2_ACCESS_KEY_ID             # dash.cloudflare.com → R2 → Manage API tokens
       npx wrangler secret put R2_SECRET_ACCESS_KEY
     (without these, uploads proxy through the Worker — still works)
  5. Giving (skip if M-Pesa not ready): MPESA_CONSUMER_KEY/SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL, MPESA_ENV
  6. npx wrangler deploy
  7. Smoke test: curl https://harvestfamily-api.<your-subdomain>.workers.dev/health
`)
