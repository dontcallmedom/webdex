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
  ["abstract-op", "algorithm"],
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

const typeOfForGivenType = {
  "attr-value": "element-attr",
  "enum-value": "enum",
  "element-attr": "element",
  "dict-member": "dictionary",
  "method": "interface",
  "attribute": "interface",
  "const": "interface",
  "event": "interface",
  "value": ["descriptor", "property", "type", "function"]
};

// if a term of a given type appears several times,
// they designate the same thing
const exclusiveNamespace = [
  "http-header",
  "selector",
  "at-rule",
  "css-descriptor",
  "property",
  "type",
  "interface", "dictionary", "typedef", "enum", "caalback",
  "constructor",
  "extended-attribute"
];

function cleanTerm(rawTerm) {
  return rawTerm.toLowerCase()
  // some terms come surrounded by quotes, but we deal with that
  // when displaying them based on their types
    .replace(/^"/, '').replace(/"$/, '')
    .replace(/^\[\[([^\]]+)\]\]/, '$1')
    .replace(/^<([^>]+)>$/, '$1')
    .replace(/^::?/, '')
    .replace(/^@@?/, '')
    .replace(/^'/, '').replace(/'$/, '')
    .replace(/^%/, '');
}

function composeDisplayName(displayTerm, type, _for, text=false) {
  let prefix='', suffix='',
      humanReadableFor = _for ? html`<code>${_for}</code>` : '',
      typeDescComp= '',
      forWrap = '',
      wrap ='';

  if (_for) {
    const typeOfFor = Array.isArray(typeOfForGivenType[type]) ? typeOfForGivenType[type] : (typeOfForGivenType[type] ? [typeOfForGivenType[type]] : undefined);
    if (typeOfFor) {
      const candidates = termIndex.get(cleanTerm(_for)) ?? {};
      // looking for one term with termid that matches @@typeOfFor
      const re = new RegExp(`@@(${typeOfFor.join('|')})$`);
      const matchingCandidates = Object.keys(candidates).filter(termId => termId.match(re));
      // we only know how to deal if there is a single match
      if (matchingCandidates.length === 1) {
        const targetTerm = termIndex.get(cleanTerm(_for))[matchingCandidates[0]];
        const page = cleanTerm(targetTerm.dfns[0].linkingText[0])[0].match(/[a-z]/) ? cleanTerm(targetTerm.dfns[0].linkingText[0])[0] + '.html' : 'other.html';
        forWrap = html`<a href="${page}#${targetTerm.displayTerm}@@${matchingCandidates[0]}">`;
      } else if (matchingCandidates.length > 1) {
        console.error(`multiple candidates for ${displayTerm} of type ${type} with scope of type ${typeOfFor}`);
      }
    }

  }

  switch(type) {
  case 'const':
  case 'dict-member':
  case 'attribute':
  case 'method':
    prefix = html`${forWrap}${_for}${forWrap ? html`</a>` : ''}.`;
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
      humanReadableFor = html`${forWrap}<code>${_for}</code>${forWrap ? html`</a>` : ''} element`;
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
      typeDescComp = html` for ${forWrap}${humanReadableFor}${forWrap ? html`</a>` : ''}${qualification}`;
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
      const term = cleanTerm(dfn.linkingText[0]);
      const displayTerm = dfn.linkingText[0].replace(/^"/, '').replace(/"$/, '');
      const termEntry = termIndex.get(term) ?? {};
      let termIds = [];
      if (dfn.for.length === 0) dfn.for.push(undefined);
      for (const _for of dfn.for) {
        const scope = _for ? _for : (exclusiveNamespace.includes(dfn.type) ? '' : spec.series.shortname);
        const termId = [scope, dfn.type].join('@@');
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
                  const webidlpedia = ['interface', 'dictionary', 'enum', 'typedef'].includes(type) ? html`<dd>see also <a href='https://dontcallmedom.github.io/webidlpedia/names/${displayTerm}.html' title='${displayTerm} entry on WebIDLpedia'>WebIDLPedia</a></dd>` : '';
                  return html`<dt id="${displayTerm}@@${termId}">${composeDisplayName(displayTerm, type, _for)}</dt>
<dd>Defined in ${dfns.map(dfn => {
                    return html`
                    <strong title='${displayTerm} is defined in ${dfn.spec}'><a href=${dfn.href}>${dfn.spec}</a></strong> `;
            })}</dd>
${refs.length ? html`<dd>Referenced in ${refs.map(ref => {
                    return html`
                    <a href=${ref.url} title='${displayTerm} is referenced by ${ref.title}'>${ref.title}</a> `;
            })}</dd>` : ''}${webidlpedia}`;
          })}`;
})}
</dl>`;
    await generatePage(`${entry}.html`, title, content);
  }
})();
