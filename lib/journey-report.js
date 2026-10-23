const states = [
  'ready_chart', 'ready_grid', 'ready_pivot', 'error', 'no_data', 'loading',
  'missing_points', 'missing_rows', 'missing_cells', 'unsupported',
];

export function journeyRecord(value, tabs) {
  const invalid = () => { throw new Error('Invalid journey measurement; raw content withheld.'); };
  const integer = (number, max) => {
    if (!Number.isSafeInteger(number) || number < 0 || number > max) invalid();
    return number;
  };
  if (!value || !['dashboard_open', 'tab_switch', 'scroll', 'readiness_diagnostic'].includes(value.action) ||
      !['passed', 'failed'].includes(value.status) ||
      !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 1800000) invalid();
  const tabIndex = integer(value.tabIndex, tabs.length - 1);
  const result = {
    sequence: integer(value.sequence, 1000), action: value.action,
    tabIndex, checkpoint: integer(value.checkpoint, 40),
    durationMs: value.durationMs, status: value.status,
  };
  if (result.sequence === 0) invalid();
  if (value.action === 'dashboard_open' && (tabIndex !== 0 || result.checkpoint !== 0)) invalid();
  if (value.widgets !== undefined) {
    if (!Array.isArray(value.widgets) || value.widgets.length > tabs[tabIndex].widgets.length) invalid();
    result.widgets = value.widgets.map((widget) => {
      if (!states.includes(widget.state)) invalid();
      const result = { widgetIndex: integer(widget.widgetIndex, tabs[tabIndex].widgets.length - 1), state: widget.state };
      if (widget.readyAfterMs !== undefined) {
        if (!Number.isFinite(widget.readyAfterMs) || widget.readyAfterMs < 0 ||
            widget.readyAfterMs > value.durationMs) invalid();
        result.readyAfterMs = widget.readyAfterMs;
      }
      if (value.status === 'passed' && result.readyAfterMs === undefined) invalid();
      if (widget.renderSignals !== undefined) {
        if (value.action !== 'readiness_diagnostic' || !widget.renderSignals ||
            typeof widget.renderSignals !== 'object') invalid();
        result.renderSignals = Object.fromEntries([
          'pivotCount', 'dataAreaCount', 'dataCellCount', 'visibleDataCellCount',
          'populatedDataCellCount', 'visiblePopulatedDataCellCount',
          'tableCellCount', 'visibleTableCellCount',
        ].map((key) => [key, integer(widget.renderSignals[key], 10000000)]));
        for (const key of [
          'chartCount', 'pointCount', 'visiblePointCount', 'seriesPointCount',
          'visibleSeriesPointCount', 'drawnSeriesPointCount',
        ]) {
          if (widget.renderSignals[key] !== undefined) {
            result.renderSignals[key] = integer(widget.renderSignals[key], 10000000);
          }
        }
      }
      if (widget.pivotStructure !== undefined) {
        if (value.action !== 'readiness_diagnostic' || !Array.isArray(widget.pivotStructure) ||
            widget.pivotStructure.length > 40 || widget.pivotStructure.some((entry) =>
              typeof entry !== 'string' || entry.length > 1000 || entry.trim() !== entry ||
              !/^(DIV|TABLE|TR|TD)( dx-[a-z-]{1,60})*$/.test(entry))) invalid();
        result.pivotStructure = [...widget.pivotStructure];
      }
      return result;
    });
    if (new Set(result.widgets.map((widget) => widget.widgetIndex)).size !== result.widgets.length) invalid();
  }
  if (result.status === 'passed' && (!result.widgets?.length ||
      !result.widgets.every((widget) => widget.state.startsWith('ready_')) ||
      result.action === 'readiness_diagnostic')) invalid();
  if (value.scroll !== undefined) {
    const scroll = value.scroll;
    if (typeof scroll.bottom !== 'boolean') invalid();
    result.scroll = {
      top: integer(scroll.top, 10000000), height: integer(scroll.height, 10000000),
      total: integer(scroll.total, 10000000), bottom: scroll.bottom,
    };
    if (result.scroll.height === 0 || result.scroll.total < result.scroll.height ||
        result.scroll.top > result.scroll.total) invalid();
  }
  if (result.status === 'passed' && !result.scroll) invalid();
  return result;
}

export function journeySummary(records, tabs) {
  const coverage = tabs.map((tab, index) => {
    const actions = records.filter((record) => record.tabIndex === index && record.status === 'passed' &&
      ['tab_switch', 'scroll'].includes(record.action));
    const widgets = new Set(actions.flatMap((record) => record.widgets.map((widget) => widget.widgetIndex)));
    return {
      tabIndex: index, expected: tab.widgets.length, verified: widgets.size,
      tabSwitchPassed: actions.some((record) => record.action === 'tab_switch'),
      bottomReached: actions.some((record) => record.scroll.bottom),
    };
  });
  return {
    complete: records.length > 0 && records.every((record) => record.status === 'passed') &&
      coverage.every((tab) => tab.verified === tab.expected && tab.tabSwitchPassed && tab.bottomReached),
    coverage,
    actions: [
      ...(records.some((record) => record.action === 'dashboard_open') ? ['dashboard_open'] : []),
      'tab_switch', 'scroll',
    ].map((action) => {
      const samples = records.filter((record) => record.action === action);
      const passed = samples.filter((record) => record.status === 'passed').map((record) => record.durationMs);
      return {
        action, samples: samples.length, failures: samples.length - passed.length,
        successfulMinMs: passed.length ? Math.min(...passed) : null,
        successfulMaxMs: passed.length ? Math.max(...passed) : null,
        successfulMeanMs: passed.length ? passed.reduce((sum, duration) => sum + duration, 0) / passed.length : null,
      };
    }),
  };
}
