import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const licenseFile = /^(?:licen[cs]es?|copying|unlicense)(?:$|[._-])/i;
const noticeFile = /^(?:notices?|copyright(?:notice)?)(?:$|[._-])/i;
const embeddedNotice = /\/\*\*?\s*(?:\*\s*)?(?:@license\b|copyright\b)[\s\S]*?\*\//gi;

export function thirdPartyNotices() {
  return {
    name: 'third-party-notices',
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
          // Vite normalizes file IDs to forward slashes. Use the innermost
          // node_modules directory for nested installs as well as scoped packages.
          if (!renderedLength || !isAbsolute(id)) continue;
          const file = id.split('?')[0];
          const directory = file.match(/^.*\/node_modules\/(?:@[^/]+\/)?[^/]+(?=\/)/)?.[0];
          if (!directory) continue;
          if (!packages.has(directory)) packages.set(directory, new Set());
          packages.get(directory).add(file);
        }
      }

      const entries = new Map();
      for (const [directory, modules] of packages) {
        const { name, version, license } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        const files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile()).map(file => file.name).sort();
        const texts = files.filter(file => licenseFile.test(file)).map(file => readFileSync(join(directory, file), 'utf8').trimEnd());
        // The Firebase SDK tarballs declare Apache-2.0 and carry copyright
        // headers, but omit the standard license text. Use the repo's full copy.
        if (!texts.length && license === 'Apache-2.0') {
          texts.push(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8').trimEnd());
        }
        if (!name || !version || !license || !texts.some(Boolean)) {
          this.error(`Missing third-party license information for ${directory}`);
        }
        for (const file of files.filter(file => noticeFile.test(file))) {
          texts.push(readFileSync(join(directory, file), 'utf8').trimEnd());
        }
        for (const id of [...modules].sort()) {
          texts.push(...(readFileSync(id, 'utf8').match(embeddedNotice) ?? []));
        }
        const heading = `Package: ${name}@${version}\nLicense: ${license}`;
        if (!entries.has(heading)) entries.set(heading, new Set());
        for (const text of texts) entries.get(heading).add(text);
      }

      const notices = [...entries.keys()].sort().map(heading => `${heading}\n\n${[...entries.get(heading)].join('\n\n')}`);
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: ['Unsigned — third-party notices', ...notices].join('\n\n' + '-'.repeat(72) + '\n\n') + '\n'
      });
    }
  };
}
