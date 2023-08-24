const fs = require("fs/promises");
const html = require('escape-html-template-tag');

const { expandCrawlResult } = require('reffy/src/lib/util');

const termIndex = new Map();
const aliasIndex = new Map();
const linksIndex = new Map();
const letters = new Map();

const typeInfo = {
  "grammar": {
    human: "grammar",
    area: "grammar"
  },
  "exception": {
    human: "exception",
    area: "webidl"
  },
  "value": {
    human: "CSS value",
    typeOfFor: ["descriptor", "property", "type", "function", "at-rule"],
    area: "css",
    caseInsensitive: true
  },
  "at-rule": {
    human: "CSS @rule",
    area: "css",
    // if a term of a given type appears several times,
    // they designate the same thing
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  "descriptor": {
    human: "CSS descriptor",
    typeOfFor: ["at-rule"],
    area: "css",
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  "selector": {
    human: "CSS selector",
    area: "css",
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  "type": {
    human: "CSS type",
    typeOfFor: ["descriptor", "property", "function"],
    area: "css",
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  "property": {
    human: "CSS property",
    area: "css",
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  "function": {
    human: "CSS function",
    typeOfFor: ["descriptor", "property", "type", "function", "at-rule"],
    area: "css",
    caseInsensitive: true
  },
  "dfn": {
    human: "concept",
    area: "concept"
  },
  "event": {
    human: "event",
    typeOfFor: ["interface"],
    area: "webidl"
  },
  "const": {
    human: "WebIDL constant",
    typeOfFor: ["interface", "namespace", "callback"],
    area: "webidl"
  },
  "interface": {
    human: "WebIDL interface",
    area: "webidl",
    exclusiveNamespace: true
  },
  "namespace": {
    human: "WebIDL namespace",
    area: "webidl",
    exclusiveNamespace: true
  },
  "method": {
    human: "WebIDL operation",
    typeOfFor: ["interface", "namespace", "callback"],
    area: "webidl"
  },
  "attribute": {
    human: "WebIDL attribute",
    typeOfFor: ["interface", "namespace"],
    area: "webidl"
  },
  "dictionary": {
    human: "WebIDL dictionary",
    area: "webidl",
    exclusiveNamespace: true
  },
  "enum": {
    human: "WebIDL enumeration",
    area: "webidl",
    exclusiveNamespace: true
  },
  "enum-value": {
    human: "value",
    typeOfFor: ["enum"],
    area: "webidl"
  },
  "abstract-op": {
    human: "algorithm",
    area: "concept"
  },
  "http-header": {
    human: "HTTP header",
    area: "http",
    exclusiveNamespace: true,
    caseInsensitive: true
  },
  'attr-value': {
    human: 'value',
    typeOfFor: ["element-attr"],
    area: "markup"
  },
  'element-attr': {
    human: 'markup attribute',
    typeOfFor: ["element"],
    area: "markup",
    caseInsensitive: true
  },
  'typedef': {
    human: 'WebIDL type alias',
    area: "webidl",
    exclusiveNamespace: true
  },
  'dict-member': {
    human: 'WebIDL dictionary member',
    typeOfFor: ["dictionary"],
    area: "webidl"
  },
  'callback': {
    human: 'WebIDL callback',
    area: "webidl",
    exclusiveNamespace: true
  },
  "constructor": {
    human: "WebIDL constructor",
    area: "webidl",
    exclusiveNamespace: true
  },
  "element": {
    human: "markup element",
    area: "markup",
    caseInsensitive: true
  },
  "element-state": {
    human: "state of markup element",
    area: "markup",
    caseInsensitive: true
  },
  "extended-attribute":{
    "human": "WebIDL extended attribute",
    area: "webidl",
    exclusiveNamespace: true
  },
  "permission": {
    human: 'permission name',
    area: "webidl",
    exclusiveNamespace: true
  }
};


function cleanTerm(rawTerm, type) {
  return (typeInfo[type]?.caseInsensitive ? rawTerm.toLowerCase() : rawTerm)
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

function sortByArea([relatedTerm1, relatedTermId1], [relatedTerm2, relatedTermId2]) {
  const {type: type1} = termIndex.get(relatedTerm1)[relatedTermId1];
  const {type: type2} = termIndex.get(relatedTerm2)[relatedTermId2];
  return typeInfo[type1].area.localeCompare(typeInfo[type2].area) || type1.localeCompare(type2) || relatedTerm1.localeCompare(relatedTerm2);
}

function getScopingTermId(type, _for, displayTerm, dfns) {
  function returnIfFound(candidates, matches) {
    if (matches.length === 1) {
      // if we've hit an alias, the scope may need to be updated
      const scope = cleanTerm(candidates[matches[0]].dfns[0].linkingText[0], candidates[matches[0]].dfns[0].type);
      return [scope, matches[0]];
    }
    return false;
  }

  if (_for) {
    let _forFor;
    // TODO: how would this work if the term used for scoping contains a '/' ?
    if (_for.includes('/')) {
      [_forFor, _for] = _for.split('/');
    }
    const typeOfFor = typeInfo[type]?.typeOfFor ? typeInfo[type][0] : undefined;
    const scope = cleanTerm(_for, typeOfFor);
    let candidates = termIndex.get(scope) ?? (aliasIndex.get(scope) ?? {});

    let ret = returnIfFound(candidates, Object.keys(candidates));
    if (ret) return ret;
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
    ret = returnIfFound(candidates, matchingCandidates);
    if (ret) {
      return ret;
    } else if (matchingCandidates.length > 1) {
      // Is one of the specs where the scoping term is defined
      // the same as where the initial term is?
      // If so, assume this is the best candidate
      const sameSpecCandidates = matchingCandidates.filter(termId => termIndex.get(scope)[termId].dfns.map(d => d.spec).find(s => dfns.map(d => d.spec).includes(s)));
      ret = returnIfFound(candidates, sameSpecCandidates);
      if (ret) return ret;

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

function wrapWithLink(markup, link) {
  if (!link) return markup;
  return html`<a href='${link}'>${markup}</a>`;
}

function wrapWithCode(markup, bool, className) {
  if (!bool) return markup;
  return html`<code${className ? html` class=${className}`: ''}>${markup}</code>`;
}


function getLink(term, termId) {
  const targetTerm = termIndex.get(term) ? termIndex.get(term)[termId] : undefined;
  if (!targetTerm) return;
  const page = (cleanTerm(targetTerm.dfns[0].linkingText[0], targetTerm.dfns[0].type) || '""').toLowerCase()[0].match(/[a-z]/) ? cleanTerm(targetTerm.dfns[0].linkingText[0], targetTerm.dfns[0].type).toLowerCase()[0] + '.html' : 'other.html';
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
    return html`<em>${typeInfo[type].human ?? type}</em> ${htmlTerm}`;
  }
  const prefix = prefixes.length === 1 ? prefixes[0] : prefixes.find(p => p === scope);
  return html`<code>${prefix}</code>${htmlTerm}`
}

function markupScope(scope, withType) {
  if (!scope) return '';
  if (Array.isArray(scope)) {
    return html`${markupScope(scope[0], true)} of ${markupScope(scope[1], true)}`;
  } else if (scope.term && scope.termId) {
    const {term, termId} = scope;
    const targetTerm = termIndex.get(term)[termId];
    const type = typeInfo[targetTerm.type]?.human?.split(' ')?.slice(1)?.join(' ')
          ?? targetTerm.type;
    return html`${wrapWithLink(wrapWithCode(targetTerm.displayTerm,
                                     isCode(targetTerm.displayTerm, targetTerm.type)),
                        getLink(term, termId))}${withType ? html` ${type}` : ''}`;
  } else {
    return wrapWithCode(scope, true);
  }
}

function isSameScope(scope) {
  return function(scope2) {
    if (Array.isArray(scope)) {
      if (!Array.isArray(scope2) || scope.length !== scope2.length) return false;
      return scope.every((x, i) => isSameScope(x)(scope2[i]));
    } else if (scope.term) {
      return scope.term === scope2.term && scope.termId === scope2.termId;
    } else {
      return scope === scope2;
    }
  };
}

function composeDisplayName(displayTerm, type, _for, prefix, dfns, termId) {
  let displayPrefix='', suffix='',
      scopeItems = _for.slice(),
      humanReadableScopeItems = _for.map(_f => html`<code>${_f}</code>`),
      typeDescComp= '',
      wrap ='';
  for (let i = 0 ; i < scopeItems.length; i++) {
    const _f = scopeItems[i];
    if (_f.includes('/')) {
      const [supScope, subScope] = _f.split('/');
      const [scope, targetTermId] = getScopingTermId(type, _f, displayTerm, dfns);
      if (targetTermId) {
        scopeItems[i] = [{term: scope, termId: targetTermId}];
        const scopeTerm = termIndex.get(scope)[targetTermId];
        const [superScope, superTargetTermId] = getScopingTermId(scopeTerm.type, supScope, scopeTerm.displayTerm, scopeTerm.dfns);
        if (superTargetTermId) {
          scopeItems[i].push({term: superScope, termId: superTargetTermId});
        } else {
          scopeItems[i].push(supScope);
        }
      } else {
        scopeItems[i] = [supScope, subScope];
      }
    } else {
      const [scope, targetTermId] = getScopingTermId(type, _f, displayTerm, dfns);
      if (targetTermId) {
        scopeItems[i] = {term: scope, termId: targetTermId};
      }
    }
  }
  // Remove possible duplicates
  scopeItems = scopeItems.filter((x, i) => scopeItems.findIndex(isSameScope(x)) === i);
  humanReadableScopeItems = scopeItems.map(markupScope);

  switch(type) {
  case 'const':
  case 'dict-member':
  case 'attribute':
  case 'method':
    const scopeForPrefix = Object.values(scopeItems).find(s => s.term === cleanTerm(prefix.slice(0, -1), type));
    if (scopeForPrefix) {
      displayPrefix = html`${wrapWithLink(html`${prefix.slice(0, -1)}`, getLink(scopeForPrefix.term, scopeForPrefix.termId))}.`;
    } else {
      prefix = null;
    }
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
  case 'permission':
  case 'enum-value':
    wrap = html`"`;
    break;
  }

  if (_for.length && !prefix) {
    let qualification = type === 'enum-value' ? html` WebIDL enumeration${_for.length > 1 ? 's' : ''}` : '';
    typeDescComp = html` for ${html.join(humanReadableScopeItems, ', ')} ${qualification}`;
  }
  let amendedType = type;
  if ((type === "method" || type === "attribute") && displayTerm.match(/^\[\[/)) {
    amendedType = `internal ${type === "attribute" ? "slot" : "method"}`;
  }
  const typeDesc = html` (<em>${typeInfo[amendedType]?.human ?? amendedType}${typeDescComp}</em>)`;
  try {
    return html`<code class=prefix>${displayPrefix}</code><strong>${wrapWithCode(html`${wrap}${displayTerm}${wrap}`, isCode(displayTerm, type), typeInfo[type].area)}</strong>${suffix}${typeDesc} <a class='self-link' href='#${encodeURIComponent(displayTerm + '@@' + termId)}' aria-label="Permalink for ${displayPrefix}${displayTerm}${suffix}">§</a>`;
  } catch (e) {
    console.error(type);
    throw e;
  }
}

async function generatePage(path, title, content, options = {}) {
  await fs.writeFile(path, `---
title: "${title}"
layout: base
${path.includes('/') ? "base: ../" : ""}
${Object.keys(options).map(k => `${k}: "${options[k]}"
`)}
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
      const term = cleanTerm(dfn.linkingText[0], dfn.type);
      const displayTerm = dfn.linkingText[0].replace(/^"/, '').replace(/"$/, '');
      const termEntry = termIndex.get(term) ?? {};
      let termId;
      let prefixes = [];
      if (dfn.for.length === 0) {
        if (typeInfo[dfn.type]?.exclusiveNamespace) {
          termId = `@@${dfn.type}`;
        } else {
          termId = `${spec.series.shortname}%%${dfn.type}`;
        }
      } else {
        if (dfn.type === "constructor" && term !== 'constructor()') {
          prefixes = ['new '];
        } else if (['method', 'const', 'attribute', 'dict-member'].includes(dfn.type)) {
          prefixes = dfn.for.map(_for => `${_for}.`);
        }
        // by convention, we use the first 'for' by alphabetical order
        termId = `${dfn.for.sort()[0]}@${dfn.type}`;
      }
      const subtermEntry = termEntry[termId] ?? {shortname: spec.series.shortname, type: dfn.type, _for: dfn.for, dfns: [], prefixes: [], refs: [], related: [], displayTerm, sortTerm: `${displayTerm}-${prefixes[0] ?? ''}`};
      subtermEntry.dfns.push({...dfn, spec: spec.shortTitle});
      subtermEntry.prefixes = subtermEntry.prefixes.concat(prefixes);
      if (!termEntry[termId]) {
        termEntry[termId] =  subtermEntry;
      }

      // keep track of aliases (they get used in some cases in dfn-for)
      for (const alias of dfn.linkingText.slice(1).map(cleanTerm, dfn.type)) {
        const aliasEntry = aliasIndex.get(alias) ?? {};
        aliasEntry[termId] = subtermEntry;
        if (!aliasIndex.has(alias)) {
          aliasIndex.set(alias, aliasEntry);
        }
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
    const fullLinks = Object.keys(spec.links || {}).reduce((acc, link) => {
      acc.push((spec.links[link].anchors || []).map(frag => link + "#" + frag));
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
    const entry = term.toLowerCase()[0] && term.toLowerCase()[0].match(/[a-z]/i) ? term.toLowerCase()[0] : 'other';
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
    const content = html`
<p class=legend>Color key: <code class=webidl>WebIDL</code> <code class='css'>CSS</code> <code class='markup'>Markup</code> <code class='http'>HTTP</code></p>
<dl>
${letters.get(entry).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())).map(term => {
  return html`${Object.keys(termIndex.get(term)).sort((a,b) =>  termIndex.get(term)[a].sortTerm.localeCompare(termIndex.get(term)[b].sortTerm))
                .map(termId => {
                  const {displayTerm, type, _for, dfns, prefixes, refs, related} = termIndex.get(term)[termId];
                  const webidlpedia = ['interface', 'dictionary', 'enum', 'typedef'].includes(type) ? html`<dd>see also <a href='https://dontcallmedom.github.io/webidlpedia/names/${displayTerm}.html' title='${displayTerm} entry on WebIDLpedia'>WebIDLPedia</a></dd>` : '';
                  return html`<dt id="${displayTerm}@@${termId}">${composeDisplayName(displayTerm, type, _for, prefixes[0] || '', dfns, termId)}</dt>
${prefixes.slice(1).map(p => html`<dt>${composeDisplayName(displayTerm, type, _for, p, dfns, termId)}</dt>`)}
<dd>Defined in ${html.join(dfns.map(dfn => {
                    return html`
                    <strong title='${displayTerm} is defined in ${dfn.spec}'><a href=${dfn.href}>${dfn.spec}</a></strong> `;
            }), ', ')}</dd>
${refs.length ? html`<dd>Referenced in ${html.join(refs.map(ref => {
                    return html`
                    <a href=${ref.url} title='${displayTerm} is referenced by ${ref.title}'>${ref.title}</a>`;
}), ', ')}</dd>` : ''}
${related.length ? html`<dd>Related terms: ${html.join(
  related.sort(sortByArea)
    .map(([relTerm, relTermId]) => {
  return composeRelatedTermName(relTerm, relTermId, displayTerm);
}), ', ')}</dd>` : ''}

${webidlpedia}`;
          })}`;
})}
</dl>`;
    await generatePage(`${entry}.html`, title, content);
  }

  const termStats = new Map([...termIndex.keys()].map(term => [term, Object.keys(termIndex.get(term)).length]).sort(([term1, len1], [term2, len2]) => len2 - len1));
  const indexContent = html`<p>This site collects the terms defined across <a href="https://github.com/w3c/browser-specs">Web specifications</a>, links to where they are defined and which specifications they are linked from.</p>
<p>The 30 most popular terms defined across Web specifications are:</p>
<ol id=terms>
${[...termStats.keys()].slice(0, 30).map(term => html`  <li><span class=term>${term}</span> (<span class=freq>${termStats.get(term)}</span>)</li>
`)}
</ol>
<canvas id=cloud width=600 height=600>
This canvas is the visual representation of the above list as a cloud of words.
</canvas>
<script src="term-cloud.js"></script>
`;

  await generatePage("index.html", "WebDex: Web specs index", indexContent, {script: "https://cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.2.2/wordcloud2.min.js"});
})();
