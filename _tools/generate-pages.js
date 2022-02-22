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

const typeOfForGivenType = new Map([
  ["attr-value", ["element-attr"]],
  ["enum-value", ["enum"]],
  ["element-attr", ["element"]],
  ["dict-member", ["dictionary"]],
  ["method", ["interface", "namespace", "callback"]],
  ["attribute", ["interface", "namespace"]],
  ["const", ["interface", "namespace", "callback"]],
  ["event", ["interface"]],
  ["descriptor", ["at-rule"]],
  ["value", ["descriptor", "property", "type", "function", "at-rule"]],
  ["function", ["descriptor", "property", "type", "function", "at-rule"]],
  ["type", ["descriptor", "property", "function"]]
]);


// if a term of a given type appears several times,
// they designate the same thing
const exclusiveNamespace = [
  "http-header",
  "selector",
  "at-rule",
  "css-descriptor",
  "property",
  "type",
  "interface", "dictionary", "typedef", "enum", "callback",
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

function getScopingTermId(type, _for, displayTerm, dfns) {
  if (_for) {
    let _forFor;
    // TODO: how would this work if the term used for scoping contains a '/' ?
    if (_for.includes('/')) {
      [_forFor, _for] = _for.split('/');
    }
    const typeOfFor = typeOfForGivenType.get(type);
    const candidates = termIndex.get(cleanTerm(_for)) ?? {};
    if (Object.keys(candidates).length === 1) {
      return [cleanTerm(_for), Object.keys(candidates)[0]];
    }
    const matchingCandidates = Object.keys(candidates).filter(termId => {
      const candidate = candidates[termId];
      // Using exact match only (deals e.g. "<position>" vs "position")
      if (!candidate.dfns[0].linkingText.includes(_for)) return false;
      // if this is part of a hierarchy, ensure it is matched
      if (_forFor) return candidate._for.includes(_forFor);
      if (typeOfFor) return typeOfFor.includes(candidate.type);
      // if no known type and no hierarchy, look for a matching unscoped term
      if (candidate._for.length === 0) return true;
      return false;
    });
    // we only know how to deal with the situation where there is a single match
    if (matchingCandidates.length === 1) {
      return [cleanTerm(_for), matchingCandidates[0]];
    } else if (matchingCandidates.length > 1) {
      // Is one of the specs where the scoping term is defined
      // the same as where the initial term is?
      // If so, assume this is the best candidate
      const sameSpecCandidates = matchingCandidates.filter(termId => termIndex.get(cleanTerm(_for))[termId].dfns.map(d => d.spec).find(s => dfns.map(d => d.spec).includes(s)));
      if (sameSpecCandidates.length === 1) {
        return [cleanTerm(_for), sameSpecCandidates[0]];
      }
      console.error(`multiple candidates for scope named |${_forFor ? _forFor + '/' : '' }${_for}|, typed <${typeOfFor}> for term '${displayTerm}' of type <${type}>: "${matchingCandidates.join('", "')}"`);
    } else if (matchingCandidates.length === 0) {
      if (Object.keys(candidates).length === 0) {
        console.error(`unrecognized scope named |${_for}| for term '${displayTerm}'`);
      } else {
        console.error(`unknown scope named |${_for}|, typed <${typeOfFor}> for term '${displayTerm}' of type <${type}>, no match`);
      }
    }
  }
  return [];
}

function getPrefix(type, _for) {
  if (!_for) return '';

  switch(type) {
  case 'const':
  case 'dict-member':
  case 'attribute':
  case 'method':
    return `${_for}.`;
    break;
  case 'constructor':
    return `new `;
    break;
  }
  return '';
}

function wrapWithLink(markup, link) {
  if (!link) return markup;
  return html`<a href='${link}'>${markup}</a>`;
}

function wrapWithCode(markup, bool, className) {
  if (!bool) return markup;
  return html`<code${className ? html` class=${className}`: ''}>${markup}</code>`;
}


function getLink(term, termId) {
  const targetTerm = termIndex.get(term)[termId];
  const page = (cleanTerm(targetTerm.dfns[0].linkingText[0]) || '""')[0].match(/[a-z]/) ? cleanTerm(targetTerm.dfns[0].linkingText[0])[0] + '.html' : 'other.html';
  return `${page}#${targetTerm.displayTerm}@@${termId.replace(/%/g, '%25')}`;
}

function isCode(displayTerm, type) {
  let isCode = true;
  if (type === 'dfn') {
    isCode = false;
  } else if (type === 'abstract-op' && displayTerm.includes(' ') && !displayTerm.includes('(')) {
    isCode = false;
  }
  return isCode;
}

function composeRelatedTermName(term, termId, scope) {
  const {prefixes, type, displayTerm} = termIndex.get(term)[termId];
  const htmlTerm = wrapWithLink(wrapWithCode(displayTerm, isCode(displayTerm, type)), getLink(term, termId));
  if (prefixes.length === 0) {
    return html`<em>${humanReadableTypes.get(type) ?? type}</em> ${htmlTerm}`;
  }
  const prefix = prefixes.length === 1 ? prefixes[0] : prefixes.find(p => p === scope);
  return html`<code>${prefix}</code>${htmlTerm}`
}

function composeDisplayName(displayTerm, type, _for, prefix, dfns) {
  let displayPrefix='', suffix='',
      humanReadableScopeItems = _for.map(_f => html`<code>${_f}</code>`),
      typeDescComp= '',
      forLinks = {},
      wrap ='';

  for (let _f of _for) {
    const [scope, targetTermId] = getScopingTermId(type, _f, displayTerm, dfns);
    if (targetTermId) {
      const targetTerm = termIndex.get(scope)[targetTermId];
      forLinks[_f] = getLink(scope, targetTermId);
      if (targetTerm.type === 'dfn') {
        humanReadableScopeItems = _for.map(_f => wrapWithLink(html`${_f}`, forLinks[_f]));
      } else {
        humanReadableScopeItems = _for.map(_f => wrapWithLink(html`<code>${_f}</code>`, forLinks[_f]));
      }
    }
  }

  switch(type) {
  case 'const':
  case 'dict-member':
  case 'attribute':
  case 'method':
    displayPrefix = html`${wrapWithLink(html`${prefix.slice(0, -1)}`, forLinks[prefix.slice(0, -1)])}.`;
    if (type === 'method' && !displayTerm.match(/\)$/)) {
      suffix = html`()`;
    }
    break;
  case 'constructor':
    displayPrefix = html`${prefix}`;
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
    humanReadableScopeItems = _for.map(_f => _f.includes('/') ? html`${wrapWithLink(html`<code>${_f.split('/')[1]}</code>`, forLinks[_f.split('/')[1]])} attribute of <code>${_f.split('/')[0]}</code> element` : wrapWithLink(html`<code>${_f}</code>`, forLinks[_f]));
    break;
  case 'element-attr':
    humanReadableScopeItems = _for.map(_f => html`${wrapWithLink(html`<code>${_f}</code>`, forLinks[_f])} element`);
    break;
  case 'value':
    humanReadableScopeItems = _for.map(_f => _f.includes('/') ? html`${wrapWithLink(html`<code>${_f.split('/')[1]}</code>`, forLinks[_f.split('/')[1]])} descriptor of <code>${_f.split('/')[0]}</code> @rule` : wrapWithLink(html`<code>${_f}</code>`, forLinks[_f]));
    break;
  }

  if (_for.length && !prefix) {
    let qualification = type === 'enum-value' ? html` WebIDL enumeration${_for.length > 1 ? 's' : ''}` : '';
    typeDescComp = html` for ${html.join(humanReadableScopeItems, ', ')} ${qualification}`;
  }
  const typeDesc = html` (<em>${humanReadableTypes.get(type) ?? type}${typeDescComp}</em>)`;
  return html`<code class=prefix>${displayPrefix}</code><strong>${wrapWithCode(html`${wrap}${displayTerm}${wrap}`, isCode(displayTerm, type))}</strong>${suffix}${typeDesc}`;
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
      let termId;
      let prefixes = [];
      if (dfn.for.length === 0) {
        if (exclusiveNamespace.includes(dfn.type)) {
          termId = `@@${dfn.type}`;
        } else {
          termId = `${spec.series.shortname}%%${dfn.type}`;
        }
      } else {
        prefixes = dfn.for.map(_for => getPrefix(dfn.type, _for)).filter(x => x).sort();
        // by convention, we use the first 'for' by alphabetical order
        termId = `${dfn.for.sort()[0]}@${dfn.type}`;
      }
      const subtermEntry = termEntry[termId] ?? {shortname: spec.series.shortname, type: dfn.type, _for: dfn.for, dfns: [], prefixes: [], refs: [], related: [], displayTerm, sortTerm: `${displayTerm}-${prefixes[0] ?? ''}`};
      subtermEntry.dfns.push({...dfn, spec: spec.shortTitle});
      subtermEntry.prefixes = subtermEntry.prefixes.concat(prefixes);
      if (!termEntry[termId]) {
        termEntry[termId] =  subtermEntry;
      }
      linksIndex.set(dfn.href, [term, termId]);
      // Account for HTML & ES multipage/single page alternatives
      if (dfn.href.startsWith('https://html.spec.whatwg.org/multipage/') ||
         dfn.href.startsWith('https://tc39.es/ecma262/multipage/')) {
        const singlePageUrl = dfn.href.replace(/\/multipage\/[^#]+#/, '\/#');
        linksIndex.set(singlePageUrl, [term, termId]);
      }
      if (!termIndex.has(term)) {
        termIndex.set(term, termEntry);
      }
    }
  }
  // await fs.writeFile('terms.json', JSON.stringify([...termIndex.entries()], null, 2));
  for (const spec of results) {
    const fullLinks = Object.keys(spec.links).reduce((acc, link) => {
      acc.push(spec.links[link].map(frag => link + "#" + frag));
      return acc;
    }, []).flat();
    for (const link of fullLinks) {
      const [term, termId] = linksIndex.get(link) || [];
      if (link === "https://html.spec.whatwg.org/multipage/iframe-embed-object.html#allowed-to-use") {
      }
      if (!term) continue;
      termIndex.get(term)[termId].refs.push({title: spec.shortTitle, url: spec.nightly.url});
    }
  }

  for (const term of termIndex.keys()) {
    // Populate index by first character
    const entry = term[0] && term[0].match(/[a-z]/i) ? term[0] : 'other';
    if (!letters.has(entry)) {
      letters.set(entry, []);
    }
    letters.get(entry).push(term);

    // Populate related terms
    for (const termId of Object.keys(termIndex.get(term))) {
      const {displayTerm, type, _for, dfns } = termIndex.get(term)[termId];
      for (const _f of _for) {
        const [scope, targetTermId] = getScopingTermId(type, _f, displayTerm, dfns);
          if (scope && targetTermId && !termIndex.get(scope)[targetTermId].related.find(x => x[0] === scope && x[1] === termId)) {
          termIndex.get(scope)[targetTermId].related.push([term, termId]);
        }
      }
    }
  }
  for (const entry of [...letters.keys()].sort()) {
    const title =  entry === 'other' ? 'Terms starting with a non-letter' : `Terms starting with letter ${entry}`;
    const content = html`<dl>
${letters.get(entry).sort().map(term => {
  return html`${Object.keys(termIndex.get(term)).sort((a,b) =>  termIndex.get(term)[a].sortTerm.localeCompare(termIndex.get(term)[b].sortTerm))
                .map(termId => {
                  const {displayTerm, type, _for, dfns, prefixes, refs, related} = termIndex.get(term)[termId];
                  const webidlpedia = ['interface', 'dictionary', 'enum', 'typedef'].includes(type) ? html`<dd>see also <a href='https://dontcallmedom.github.io/webidlpedia/names/${displayTerm}.html' title='${displayTerm} entry on WebIDLpedia'>WebIDLPedia</a></dd>` : '';
                  return html`<dt id="${displayTerm}@@${termId}">${composeDisplayName(displayTerm, type, _for, prefixes[0] || '', dfns)}</dt>
${prefixes.slice(1).map(p => html`<dt>${composeDisplayName(displayTerm, type, _for, p, dfns)}</dt>`)}
<dd>Defined in ${html.join(dfns.map(dfn => {
                    return html`
                    <strong title='${displayTerm} is defined in ${dfn.spec}'><a href=${dfn.href}>${dfn.spec}</a></strong> `;
            }), ', ')}</dd>
${refs.length ? html`<dd>Referenced in ${html.join(refs.map(ref => {
                    return html`
                    <a href=${ref.url} title='${displayTerm} is referenced by ${ref.title}'>${ref.title}</a>`;
}), ', ')}</dd>` : ''}
${related.length ? html`<dd>Related terms: ${html.join(related.map(([relTerm, relTermId]) => {
  return composeRelatedTermName(relTerm, relTermId, displayTerm);
}), ', ')}</dd>` : ''}

${webidlpedia}`;
          })}`;
})}
</dl>`;
    await generatePage(`${entry}.html`, title, content);
  }
})();
