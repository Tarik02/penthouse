import csstree from 'css-tree'
import debug from 'debug'

const debuglog = debug('penthouse:preformatting:selectors-profile')

var pseudoSelectorsToKeep = [
  ':before',
  ':after',
  ':visited',
  ':first-letter',
  ':first-line'
]
// detect these selectors regardless of whether one or two semicolons are used
var pseudoSelectorsToKeepRegex = pseudoSelectorsToKeep
  .map(function (s) {
    return ':?' + s
  })
  .join('|') // separate in regular expression
// we will replace all instances of these pseudo selectors; hence global flag
var PSUEDO_SELECTOR_REGEXP = new RegExp(pseudoSelectorsToKeepRegex, 'g')

function matchesSelectors (selector, selectors) {
  return selectors.some(function (toMatchSelector) {
    if (toMatchSelector.type === 'RegExp') {
      const { source, flags } = toMatchSelector
      const re = new RegExp(source, flags)
      return re.test(selector)
    }
    return toMatchSelector.value === selector
  })
}

// returns:
// true, if selector should be force kept
// false, if selector should be force removed
// otherwise the selector string to look for in the critical viewport
function normalizeSelector (selectorNode, forceInclude, forceExclude) {
  const selector = csstree.generate(selectorNode)
  // some selectors can't be matched on page.
  // In these cases we test a slightly modified selector instead
  let modifiedSelector = selector.trim()

  if (forceInclude && matchesSelectors(modifiedSelector, forceInclude)) {
    debuglog('forceInclude', modifiedSelector)
    return true
  }

  if (forceExclude && matchesSelectors(modifiedSelector, forceExclude)) {
    debuglog('forceExclude', modifiedSelector)
    return false
  }

  if (modifiedSelector.indexOf(':') > -1) {
    // handle special case selectors, the ones that contain a semicolon (:)
    // many of these selectors can't be matched to anything on page via JS,
    // but that still might affect the above the fold styling

    // ::selection we just remove
    if (/:?:(-moz-)?selection/.test(modifiedSelector)) {
      return false
    }

    // for the pseudo selectors that depend on an element, test for presence
    // of the element (in the critical viewport) instead
    // (:hover, :focus, :active would be treated same
    // IF we wanted to keep them for critical path css, but we don’t)
    modifiedSelector = modifiedSelector.replace(PSUEDO_SELECTOR_REGEXP, '')

    // if selector is purely pseudo (f.e. ::-moz-placeholder), just keep as is.
    // we can't match it to anything on page, but it can impact above the fold styles
    if (
      modifiedSelector.replace(/:[:]?([a-zA-Z0-9\-_])*/g, '').trim().length ===
      0
    ) {
      return true
    }

    // handle browser specific pseudo selectors bound to elements,
    // Example, button::-moz-focus-inner, input[type=number]::-webkit-inner-spin-button
    // remove browser specific pseudo and test for element
    modifiedSelector = modifiedSelector.replace(/(?<!\\):?:-[a-z-]*/g, '')
  }

  return modifiedSelector
}

export default async function buildSelectorProfile (
  ast,
  forceInclude,
  forceExclude
) {
  debuglog('buildSelectorProfile START')
  const selectors = new Set()
  const selectorNodeMap = new WeakMap()

  csstree.walk(ast, {
    visit: 'Rule',
    enter: function (rule, item, list) {
      // ignore rules inside @keyframes at-rule
      if (
        this.atrule &&
        csstree.keyword(this.atrule.name).basename === 'keyframes'
      ) {
        return
      }

      // ignore a rule with a bad selector
      if (rule.prelude.type !== 'SelectorList') {
        return
      }

      const addedRule = rule.block.children.some(declarationNode => {
        if (declarationNode.property === 'grid-area') {
          const ruleSelectorList = csstree.generate(rule.prelude)
          debuglog('rule contains grid-area, keeping: ', ruleSelectorList)
          selectors.add(ruleSelectorList)
          selectorNodeMap.set(rule.prelude, ruleSelectorList)
          return true
        }
      })
      if (addedRule) return

      // collect selectors and build a map
      rule.prelude.children.each(selectorNode => {
        const selector = normalizeSelector(
          selectorNode,
          forceInclude,
          forceExclude
        )
        if (typeof selector === 'string') {
          selectors.add(selector)
        }
        selectorNodeMap.set(selectorNode, selector)
      })
    }
  })

  debuglog('buildSelectorProfile DONE')
  return {
    selectorNodeMap,
    selectors: Array.from(selectors)
  }
}
