const steps = ['initial_viewport', 'scroll_checkpoint', 'tab_switch', 'filter_open', 'filter_applied', 'filter_reset'];
const signalSelectors = [
  '.highcharts-root', '.highcharts-point', 'canvas', 'table', '[role="grid"]',
  '[role="row"]', '[role="cell"]', '.rdLoadingIndicator', '[role="alert"]',
  '[class*="table"]', '[class*="error"]', '[class*="noData"]', '[class*="empty"]',
];

export function discoveryCheckpoint(value) {
  const invalid = () => { throw new Error('Invalid discovery checkpoint; raw content withheld.'); };
  const number = (item, minimum = 0) => {
    if (!Number.isSafeInteger(item) || item < minimum) invalid();
    return item;
  };
  const text = (item, limit = 200) => {
    if (typeof item !== 'string' || item.length > limit || /[\x00-\x1f\x7f]/.test(item)) invalid();
    return item;
  };
  const bool = (item) => {
    if (typeof item !== 'boolean') invalid();
    return item;
  };
  const array = (item, limit) => {
    if (!Array.isArray(item) || item.length > limit) invalid();
    return item;
  };
  const path = (item) => {
    if (typeof item !== 'string' || item.length > 2000 ||
        !/^html( > [a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\))+$/.test(item)) invalid();
    return item;
  };
  const nullableBool = (item) => item === null ? null : bool(item);
  if (!value || !steps.includes(value.step)) invalid();
  return {
    ...(value.filterInspection === undefined ? {} : {
      filterInspection: {
        popupVisible: bool(value.filterInspection.popupVisible),
        controls: array(value.filterInspection.controls, 60).map((control) => {
          if (!['study_group', 'checkbox', 'apply', 'cancel'].includes(control.kind)) invalid();
          if (control.kind === 'checkbox' ? typeof control.checked !== 'boolean' : control.checked !== null) invalid();
          return { kind: control.kind, path: path(control.path), checked: control.checked,
            mixed: bool(control.mixed), disabled: bool(control.disabled) };
        }),
        ...(value.filterInspection.customControls === undefined ? {} : {
          customControls: array(value.filterInspection.customControls, 80).map((control) => {
            if (typeof control.signature !== 'string' || control.signature.length > 1100 ||
                !/^[A-Z][A-Z0-9-]*( [a-zA-Z][a-zA-Z0-9_-]{0,99}){0,10}$/.test(control.signature) ||
                control.signature.trim() !== control.signature) invalid();
            return { path: path(control.path), signature: control.signature,
              visible: bool(control.visible), checked: nullableBool(control.checked),
              selected: nullableBool(control.selected) };
          }),
          customControlsTruncated: bool(value.filterInspection.customControlsTruncated),
        }),
        ...(value.filterInspection.applications === undefined ? {} : {
          applications: array(value.filterInspection.applications, 10).map((entry, index) => {
            if (entry.index !== index + 1 || entry.elapsedMs > 120000 || entry.chartMutations > 1000000) invalid();
            return { index: number(entry.index, 1), elapsedMs: number(entry.elapsedMs),
              spinnerSeen: bool(entry.spinnerSeen), spinnerCleared: bool(entry.spinnerCleared),
              chartMutations: number(entry.chartMutations), observationExpired: bool(entry.observationExpired) };
          }),
          applicationLimitReached: bool(value.filterInspection.applicationLimitReached),
        }),
      },
    }),
    sequence: number(value.sequence, 1),
    step: value.step,
    viewport: { width: number(value.viewport.width, 1), height: number(value.viewport.height, 1) },
    tabs: array(value.tabs, 20).map((tab) => ({ name: text(tab.name), selected: bool(tab.selected) })),
    scrollContainers: array(value.scrollContainers, 20).map((container) => ({
      tag: text(container.tag, 20), top: number(container.top),
      height: number(container.height), scrollHeight: number(container.scrollHeight),
    })),
    widgets: array(value.widgets, 100).map((widget) => ({
      title: text(widget.title),
      visible: bool(widget.visible),
      intersectsViewport: bool(widget.intersectsViewport),
      box: {
        x: number(widget.box.x, -1000000), y: number(widget.box.y, -1000000),
        width: number(widget.box.width), height: number(widget.box.height),
      },
      signals: Object.fromEntries(signalSelectors.map((selector) => [selector, number(widget.signals[selector])])),
      structure: array(widget.structure, 40).map((item) => {
        if (typeof item !== 'string' || !/^[a-zA-Z0-9_ -]{1,2000}$/.test(item)) invalid();
        return item;
      }),
    })),
  };
}
