const widgetStates = [
  'ready_chart', 'ready_grid', 'ready_pivot', 'error', 'no_data', 'loading',
  'missing_points', 'missing_rows', 'missing_cells', 'unsupported', 'missing', 'duplicate',
];

export function filterReadiness(snapshot, tab) {
  const diagnostics = {
    scrollTop: snapshot.scroll.top,
    selectedTabCount: snapshot.selectedTabs.length,
    expectedTabSelected: snapshot.selectedTabs.includes(tab.name),
    visibleWidgetCount: snapshot.widgets.length,
    unexpectedWidgetCount: snapshot.widgets.filter((widget) => !tab.initialWidgets.includes(widget.title)).length,
    widgets: tab.initialWidgets.map((title, widgetIndex) => {
      const matches = snapshot.widgets.filter((widget) => widget.title === title);
      return { widgetIndex, matches: matches.length,
        state: matches.length === 0 ? 'missing' : matches.length > 1 ? 'duplicate' : matches[0].state };
    }),
  };
  return {
    diagnostics,
    invalidResult: snapshot.widgets.some((widget) => ['error', 'no_data'].includes(widget.state)),
    ready: diagnostics.scrollTop === 0 && diagnostics.selectedTabCount === 1 &&
      diagnostics.expectedTabSelected && diagnostics.visibleWidgetCount === tab.initialWidgets.length &&
      diagnostics.widgets.every((widget) => widget.matches === 1 && widget.state.startsWith('ready_')),
  };
}

export function filterRecord(value) {
  const fail = () => { throw new Error('Invalid filter measurement; raw output withheld.'); };
  if (!value || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 2 ||
      value.action !== (value.sequence === 1 ? 'filter_apply' : 'filter_reset') ||
      !['passed', 'failed'].includes(value.status) ||
      !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 600000) fail();
  const result = { sequence: value.sequence, action: value.action,
    status: value.status, durationMs: value.durationMs };
  for (const key of ['selectionVerified', 'spinnerSeen', 'spinnerCleared', 'rendererChanged', 'widgetsReady']) {
    if (typeof value[key] !== 'boolean') fail();
    result[key] = value[key];
    if (value.status === 'passed' && !value[key]) fail();
  }
  if (value.stage !== undefined) {
    if (!['prepare', 'apply', 'refresh', 'verify'].includes(value.stage) ||
        !['none', 'dialog', 'button', 'option_count', 'option_structure', 'option_label',
          'duplicate_identity', 'other_state', 'option_set', 'selection', 'trigger',
          'already_captured', 'no_eligible_option', 'target_missing', 'target_ineligible', 'command'].includes(value.guardReason) ||
        typeof value.originalCaptured !== 'boolean') fail();
    result.stage = value.stage;
    result.guardReason = value.guardReason;
    result.originalCaptured = value.originalCaptured;
  }
  if (value.optionComparison !== undefined) {
    if (value.status !== 'failed' || !value.stage) fail();
    const comparison = value.optionComparison;
    if (!comparison || typeof comparison.targetPresent !== 'boolean' ||
        typeof comparison.auxiliaryStateMatches !== 'boolean') fail();
    result.optionComparison = {};
    for (const key of ['originalCount', 'currentCount', 'exactMatchCount', 'counterIndependentMatchCount']) {
      if (!Number.isSafeInteger(comparison[key]) || comparison[key] < 0 || comparison[key] > 100) fail();
      result.optionComparison[key] = comparison[key];
    }
    if (comparison.exactMatchCount > Math.min(comparison.originalCount, comparison.currentCount) ||
        comparison.counterIndependentMatchCount < comparison.exactMatchCount ||
        comparison.counterIndependentMatchCount > comparison.originalCount) fail();
    result.optionComparison.targetPresent = comparison.targetPresent;
    result.optionComparison.auxiliaryStateMatches = comparison.auxiliaryStateMatches;
    const caseFields = ['caseInsensitiveMatchCount', 'caseInsensitiveTargetCount', 'caseInsensitiveUnique'];
    if (caseFields.some((key) => comparison[key] !== undefined)) {
      if (!Number.isSafeInteger(comparison.caseInsensitiveMatchCount) ||
          comparison.caseInsensitiveMatchCount < comparison.exactMatchCount ||
          comparison.caseInsensitiveMatchCount > comparison.originalCount ||
          !Number.isSafeInteger(comparison.caseInsensitiveTargetCount) ||
          comparison.caseInsensitiveTargetCount < 0 ||
          comparison.caseInsensitiveTargetCount > comparison.currentCount ||
          (comparison.targetPresent && comparison.caseInsensitiveTargetCount === 0) ||
          typeof comparison.caseInsensitiveUnique !== 'boolean' ||
          (comparison.caseInsensitiveUnique &&
            (comparison.caseInsensitiveTargetCount > 1 ||
              comparison.caseInsensitiveMatchCount > comparison.currentCount))) fail();
      for (const key of caseFields) result.optionComparison[key] = comparison[key];
    }
  }
  if (value.refresh !== undefined) {
    if (value.status !== 'failed' || !['refresh', 'verify'].includes(value.stage)) fail();
    const refresh = value.refresh;
    const readiness = refresh?.readiness;
    const integer = (number, max = 10000) => {
      if (!Number.isSafeInteger(number) || number < 0 || number > max) fail();
      return number;
    };
    if (typeof refresh?.applicationObserved !== 'boolean' || typeof refresh.popupClosed !== 'boolean' ||
        typeof readiness?.expectedTabSelected !== 'boolean' || !Array.isArray(readiness.widgets) ||
        !readiness.widgets.length || readiness.widgets.length > 100) fail();
    result.refresh = {
      applicationObserved: refresh.applicationObserved, popupClosed: refresh.popupClosed,
      readiness: {
        scrollTop: integer(readiness.scrollTop, 10000000),
        selectedTabCount: integer(readiness.selectedTabCount),
        expectedTabSelected: readiness.expectedTabSelected,
        visibleWidgetCount: integer(readiness.visibleWidgetCount),
        unexpectedWidgetCount: integer(readiness.unexpectedWidgetCount),
        widgets: readiness.widgets.map((widget, index) => {
          if (widget.widgetIndex !== index || !widgetStates.includes(widget.state)) fail();
          const matches = integer(widget.matches);
          if ((matches === 0 && widget.state !== 'missing') ||
              (matches === 1 && ['missing', 'duplicate'].includes(widget.state)) ||
              (matches > 1 && widget.state !== 'duplicate')) fail();
          return { widgetIndex: index, matches, state: widget.state };
        }),
      },
    };
    if (readiness.widgets.reduce((total, widget) => total + widget.matches, 0) +
        readiness.unexpectedWidgetCount !== readiness.visibleWidgetCount) fail();
  }
  if (value.structureInspection !== undefined) {
    if (!result.refresh) fail();
    const inspection = value.structureInspection;
    if (!inspection || !['captured', 'unavailable'].includes(inspection.status)) fail();
    result.structureInspection = { status: inspection.status };
    if (inspection.status === 'captured') {
      if (!Array.isArray(inspection.widgets) ||
          inspection.widgets.length !== result.refresh.readiness.widgets.length) fail();
      result.structureInspection.widgets = inspection.widgets.map((widget, index) => {
        if (!widget || widget.widgetIndex !== index ||
            !Number.isSafeInteger(widget.matches) || widget.matches < 0 || widget.matches > 10000) fail();
        const projected = { widgetIndex: index, matches: widget.matches };
        if (widget.matches !== 1) {
          if (widget.structure !== undefined) fail();
          return projected;
        }
        const structure = widget.structure;
        const integer = (number, max) => {
          if (!Number.isSafeInteger(number) || number < 0 || number > max) fail();
          return number;
        };
        if (!structure || typeof structure.scanTruncated !== 'boolean' ||
            typeof structure.treeTruncated !== 'boolean' || !structure.counts ||
            !Array.isArray(structure.nodes) || structure.nodes.length > 40) fail();
        const scanned = integer(structure.scanned, 200);
        const visibleCount = integer(structure.visibleCount, scanned);
        if (structure.nodes.length !== Math.min(scanned, 40) ||
            structure.treeTruncated !== (scanned > 40) ||
            (structure.scanTruncated && scanned !== 200)) fail();
        projected.structure = {
          scanned, visibleCount, scanTruncated: structure.scanTruncated,
          treeTruncated: structure.treeTruncated,
          counts: Object.fromEntries(['svg', 'canvas', 'iframe', 'table', 'image',
            'highcharts', 'grid', 'pivot', 'alert', 'status', 'progress'].map((key) =>
            [key, integer(structure.counts[key], visibleCount)])),
          nodes: structure.nodes.map((node) => {
            if (!node || !['div', 'span', 'p', 'section', 'article', 'svg', 'g', 'path', 'text',
              'canvas', 'iframe', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
              'button', 'a', 'input', 'label', 'h1', 'h2', 'h3', 'ul', 'li', 'other'].includes(node.tag) ||
                !['alert', 'status', 'progressbar', 'img', 'grid', 'treegrid', 'row', 'cell',
                  'heading', 'button', 'table', 'presentation', 'none', 'other'].includes(node.role) ||
                typeof node.visible !== 'boolean' || typeof node.hasDirectText !== 'boolean') fail();
            return { tag: node.tag, role: node.role, depth: integer(node.depth, 32),
              visible: node.visible, hasDirectText: node.hasDirectText };
          }),
        };
        return projected;
      });
    } else if (inspection.widgets !== undefined) fail();
  }
  return result;
}

export function filterSummary(records) {
  return {
    complete: records.length === 2 && records.every((record, index) =>
      record.sequence === index + 1 && record.status === 'passed'),
    restorationVerified: records.some((record) => record.action === 'filter_reset' &&
      record.status === 'passed' && record.selectionVerified),
    actions: records.map((record) => ({ ...record })),
  };
}
