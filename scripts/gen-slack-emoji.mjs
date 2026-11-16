// Generates src/lib/slack-emoji.json: Slack's standard emoji short names
// (":palm_tree:" without colons) mapped to the emoji character. Slack names its
// emoji after the iamcal emoji-data set, which the emoji-datasource package
// ships. Re-run after bumping emoji-datasource:
//
//   node scripts/gen-slack-emoji.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const data = JSON.parse(readFileSync(require.resolve('emoji-datasource/emoji.json'), 'utf8'))

const toChar = (unified) => String.fromCodePoint(...unified.split('-').map((h) => parseInt(h, 16)))

const map = {}
for (const e of data.sort((a, b) => a.sort_order - b.sort_order)) {
  const char = toChar(e.unified)
  for (const name of e.short_names) map[name] ??= char
}

writeFileSync(new URL('../src/lib/slack-emoji.json', import.meta.url), JSON.stringify(map))
console.log(`${Object.keys(map).length} emoji names`)
