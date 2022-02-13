const fs = require("fs/promises");
const html = require('escape-html-template-tag');

const { expandCrawlResult } = require('reffy/src/lib/util');

const termIndex = new Map();
const linksIndex = new Map();
const letters = new Map();

const humanReadableTypes = new Map([
  ["value", "CSS value"],
  ["at-rule", "CSS @rule"],
  ["descriptor", "CSS descriptor"],
  ["selector", "CSS selector"],
  ["type", "CSS type"],
  ["property", "CSS property"],
  ["function", "CSS function"],
  ["dfn", "concept"],
  ["const", "WebIDL constant"],
  ["interface", "WebIDL interface"],
  ["method", "WebIDL operation"],
  ["attribute", "WebIDL attribute"],
  ["dictionary", "WebIDL dictionary"],
  ["enum", "WebIDL enumeration"],
  ["enum-value", "value"],
  ["abstract-op", "abstract operation"],
  ["http-header", "HTTP header"],
  ['attr-value', 'value'],
  ['element-attr', 'markup attribute'],
  ['typedef', 'WebIDL type alias'],
  ['dict-member', 'WebIDL dictionary member'],
  ['callback', 'WebIDL callback'],
  ["constructor", "WebIDL constructor"],
  ["element", "markup element"],
  ['extended-attribute', 'WebIDL extended attribute']
]);

function composeDisplayName(displayTerm, type, _for, text=false) {
  let prefix='', suffix='',
      humanReadableFor = _for ? html`<code>${_for}</code>` : '',
      typeDescComp='',
      wrap ='';
  switch(type) {
  case 'const':
  case 'dict-member':
  case 'attribute':
  case 'method':
    prefix = html`${_for}.`;
    break;
  case 'constructor':
    prefix = html`new `;
    if (!displayTerm.match(/\)$/)) {
      suffix = html`()`;
    }
    break;
  case 'http-header':
    suffix = html`:`;
    break;
  case 'enum-value':
    wrap = html`"`;
    break;
  case 'attr-value':
    if (_for && _for.includes('/')) {
      humanReadableFor= html`<code>${_for.split('/')[1]}</code> attribute of <code>${_for.split('/')[0]}</code> element`;
    }
    break;
  case 'element-attr':
    if (_for) {
      humanReadableFor = html`<code>${_for}</code> element`;
    }
    break;
  }
  if (_for) {
    let qualification = '';
    switch(type) {
    case 'enum-value':
      qualification = html` WebIDL enumeration`;
      // intentional non-break;
    case 'dfn':
    case 'value':
    case 'attr-value':
    case 'element-attr':
    case 'event':
    case 'function':
      typeDescComp = html` for ${humanReadableFor}${qualification}`;
      break;
    }
  }
  const typeDesc = html` (<em>${humanReadableTypes.get(type) ?? type}${typeDescComp}</em>)`;
  if (text) {
    return [displayTerm, prefix];
  }
  return html`<code class=prefix>${prefix}</code><strong>${type !== 'dfn' ? html`<code>`: ''}${wrap}${displayTerm}${wrap}${type !== 'dfn' ? html`</code>`: ''}</strong>${suffix}${typeDesc}`;
}

async function generatePage(path, title, content) {
  await fs.writeFile(path, `---
title: ${title}
layout: base
${path.includes('/') ? "base: ../" : ""}
---
${content}`);
}


(async function() {
  const jsonIndex = await fs.readFile("./webref/ed/index.json", "utf-8");
  const index = JSON.parse(jsonIndex);
  const {results} = await expandCrawlResult(index, './webref/ed/', ['dfns', 'links']);
  for (const spec of results) {
    for (const dfn of (spec.dfns || [])) {
      if (dfn.access === "private") continue;
      if (dfn.type === "argument") continue;
      // only use the first linkingText
      const term = dfn.linkingText[0]
            .toLowerCase()
      // some terms come surrounded by quotes, but we deal with that
      // when displaying them based on their types
            .replace(/^"/, '').replace(/"$/, '')
            .replace(/^\[\[([^\]]+)\]\]/, '$1')
            .replace(/^<([^>]+)>$/, '$1')
            .replace(/^::?/, '')
            .replace(/^@@?/, '')
            .replace(/^'/, '').replace(/'$/, '')
            .replace(/^%/, '');
      const displayTerm = dfn.linkingText[0].replace(/^"/, '').replace(/"$/, '');
      const termEntry = termIndex.get(term) ?? {};
      let termIds = [];
      if (dfn.for.length === 0) dfn.for.push(undefined);
      for (const _for of dfn.for) {
        const termId = [_for ? _for : spec.series.shortname, dfn.type].join('@@');
        const [, prefix] = composeDisplayName(displayTerm, dfn.type, _for, true);
        const subtermEntry = termEntry[termId] ?? {shortname: spec.series.shortname, type: dfn.type, _for, dfns: [], refs: [], displayTerm, sortTerm: `${displayTerm}-${prefix}`};
        subtermEntry.dfns.push({...dfn, spec: spec.shortTitle});
        if (!termEntry[termId]) {
          termEntry[termId] =  subtermEntry;
        }
        termIds.push(termId);
      }
      linksIndex.set(dfn.href, [term, termIds]);
      // Account for HTML & ES multipage/single page alternatives
      if (dfn.href.startsWith('https://html.spec.whatwg.org/multipage/') ||
         dfn.href.startsWith('https://tc39.es/ecma262/multipage/')) {
        const singlePageUrl = dfn.href.replace(/\/multipage\/[^#]+#/, '\/#');
        linksIndex.set(singlePageUrl, [term, termIds]);
      }
      if (!termIndex.has(term)) {
        termIndex.set(term, termEntry);
      }
    }
  }

  for (const spec of results) {
    const fullLinks = Object.keys(spec.links).reduce((acc, link) => {
      acc.push(spec.links[link].map(frag => link + "#" + frag));
      return acc;
    }, []).flat();
    for (const link of fullLinks) {
      const [term, termIds] = linksIndex.get(link) || [];
      if (link === "https://html.spec.whatwg.org/multipage/iframe-embed-object.html#allowed-to-use") {
        console.log(term, termIds);
      }
      if (!term) continue;
      for (let termId of termIds) {
        termIndex.get(term)[termId].refs.push({title: spec.shortTitle, url: spec.nightly.url});
        }
    }
  }

  for (const term of termIndex.keys()) {
    const entry = term[0] && term[0].match(/[a-z]/i) ? term[0] : 'other';
    if (!letters.has(entry)) {
      letters.set(entry, []);
    }
    letters.get(entry).push(term);
  }
  for (const entry of [...letters.keys()].sort()) {
    const title =  entry === 'other' ? 'Terms starting with a non-letter' : `Terms starting with letter ${entry}`;
    const content = html`<dl>
${letters.get(entry).sort().map(term => {
  return html`${Object.keys(termIndex.get(term)).sort((a,b) =>  termIndex.get(term)[a].sortTerm.localeCompare(termIndex.get(term)[b].sortTerm))
                .map(termId => {
                  const {displayTerm, type, _for, dfns, refs} = termIndex.get(term)[termId];
                  return html`<dt>${composeDisplayName(displayTerm, type, _for)}</dt>
<dd>${dfns.map(dfn => {
                    return html`
                    <strong><a href=${dfn.href}>${dfn.spec}</a></strong> `;
            })}
${refs.map(ref => {
                    return html`
                    <a href=${ref.url}>${ref.title}</a> `;
            })}</dd>`;
          })}`;
})}
</dl>`;
    await generatePage(`${entry}.html`, title, content);
  }
})();
