import { dashboardWidget } from './dashboard-probe.js';

const iframeSelector = 'iframe[src^="https://medidata-dev.thoughtspot.cloud/"]';

function installFilterObserver() {
  if (window.__k6FilterInspection) throw new Error('Filter observer already installed.');
  const state = { applications: [], limitReached: false };
  let timer;
  let observer;
  function visible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function stop() {
    clearInterval(timer);
    observer?.disconnect();
  }
  function onClick(event) {
    const button = event.target.closest('button, [role="button"]');
    const dialog = button?.closest('[role="dialog"]');
    if (!dialog || !dialog.textContent.includes('Apply filters and parameters') ||
        button.textContent.trim() !== 'Apply' || !visible(button)) return;
    stop();
    if (state.applications.length >= 10) {
      state.limitReached = true;
      return;
    }
    const started = performance.now();
    const entry = {
      index: state.applications.length + 1, elapsedMs: 0,
      spinnerSeen: false, spinnerCleared: false, chartMutations: 0, observationExpired: false,
    };
    state.applications.push(entry);
    function sample() {
      entry.elapsedMs = Math.min(120000, Math.round(performance.now() - started));
      const loading = Array.from(document.querySelectorAll(
        '[data-testid="answer-content"] .rdLoadingIndicator, ' +
        '[data-testid="answer-content"] [role="progressbar"], ' +
        '[data-testid="answer-content"] [aria-busy="true"]'
      )).some(visible);
      if (loading) entry.spinnerSeen = true;
      if (entry.spinnerSeen && !loading) entry.spinnerCleared = true;
      if (entry.elapsedMs >= 120000) {
        entry.observationExpired = true;
        stop();
      }
    }
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const node = mutation.target.nodeType === Node.ELEMENT_NODE ?
          mutation.target : mutation.target.parentElement;
        const renderer = '.highcharts-container, .ag-root, .dx-pivotgrid';
        const replacedRenderer = mutation.type === 'childList' &&
          [...mutation.addedNodes, ...mutation.removedNodes].some((child) =>
            child.nodeType === Node.ELEMENT_NODE &&
            (child.matches(renderer) || child.querySelector(renderer)));
        if (node?.closest('[data-testid="answer-content"]') &&
            (node.closest(renderer) || replacedRenderer)) {
          entry.chartMutations = Math.min(1000000, entry.chartMutations + 1);
        }
      }
      sample();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setInterval(sample, 50);
    sample();
  }
  document.addEventListener('click', onClick, true);
  state.stop = () => { stop(); document.removeEventListener('click', onClick, true); };
  window.__k6FilterInspection = state;
}

function installDiscoveryPanel() {
  if (document.getElementById('k6-discovery-panel')) {
    throw new Error('Discovery panel already exists.');
  }
  const panel = document.createElement('section');
  panel.id = 'k6-discovery-panel';
  panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;' +
    'background:white;color:black;border:2px solid #245;padding:10px;font:14px sans-serif;max-width:360px';
  const instructions = document.createElement('p');
  instructions.textContent = 'k6 discovery (not a performance recording). Choose a checkpoint, then Capture. ' +
    'Start with Initial viewport. Scroll one screen at a time, capturing each position; then visit each tab. ' +
    'Do not export or change saved settings.';
  const steps = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Checkpoint type';
  steps.append(legend);
  for (const [value, label] of [
    ['initial_viewport', 'Initial viewport'],
    ['scroll_checkpoint', 'Scroll checkpoint'],
    ['tab_switch', 'Tab switch'],
    ['filter_open', 'Filter popup open (before changing selection)'],
    ['filter_applied', 'Filter applied (session-only)'],
    ['filter_reset', 'Filter reset'],
  ]) {
    const row = document.createElement('label');
    row.style.cssText = 'display:block';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'k6-discovery-step';
    radio.value = value;
    radio.checked = value === 'initial_viewport';
    row.append(radio, document.createTextNode(label));
    steps.append(row);
  }
  const status = document.createElement('p');
  status.id = 'k6-discovery-status';
  status.textContent = 'Ready. Capture before scrolling or switching tabs.';
  for (const [command, label] of [['capture', 'Capture checkpoint'], ['finish', 'Finish discovery']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.command = command;
    button.onclick = () => {
      panel.dataset.command = command;
      panel.dataset.step = panel.querySelector('input[name="k6-discovery-step"]:checked').value;
      for (const control of panel.querySelectorAll('button, input')) control.disabled = true;
      status.textContent = command === 'capture' ? 'Capturing. Please pause...' : 'Finishing...';
    };
    panel.append(button);
  }
  panel.prepend(instructions, steps);
  panel.append(status);
  document.body.append(panel);
}

function dashboardSnapshot() {
  function visible(node) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  const round = (value) => Math.round(value);
  function box(node) {
    const rect = node.getBoundingClientRect();
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
  }
  const widgets = Array.from(document.querySelectorAll('[data-testid="answer-content"]')).slice(0, 100)
    .map((element) => {
      const heading = element.querySelector('[data-testid="dynamic-title-box"] [role="heading"]');
      const rect = element.getBoundingClientRect();
      const countVisible = (selector) => Array.from(element.querySelectorAll(selector)).filter(visible).length;
      const selectors = [
        '.highcharts-root', '.highcharts-point', 'canvas', 'table', '[role="grid"]',
        '[role="row"]', '[role="cell"]', '.rdLoadingIndicator', '[role="alert"]',
        '[class*="table"]', '[class*="error"]', '[class*="noData"]', '[class*="empty"]',
      ];
      return {
        title: heading ? heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        visible: visible(element),
        intersectsViewport: visible(element) && rect.bottom > 0 && rect.right > 0 &&
          rect.top < innerHeight && rect.left < innerWidth,
        box: box(element),
        signals: Object.fromEntries(selectors.map((selector) => [selector, countVisible(selector)])),
        structure: Array.from(new Set(Array.from(element.querySelectorAll(
          '[data-testid], [role], [class*="table"], [class*="error"], [class*="noData"], [class*="empty"]'
        )).map((node) => [
          node.tagName,
          node.getAttribute('role') || '',
          node.getAttribute('data-testid') || '',
          ...Array.from(node.classList),
        ].filter((token) => /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(token)).join(' ')))).slice(0, 40),
      };
    });
  function controlPath(element) {
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      const siblings = Array.from(node.parentElement?.children || []).filter((child) => child.tagName === node.tagName);
      parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return 'html > ' + parts.join(' > ');
  }
  const normalize = (element) => element.textContent.replace(/\s+/g, ' ').trim();
  const popup = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) =>
    visible(element) && element.textContent.includes('Apply filters and parameters'));
  const filterControls = Array.from(document.querySelectorAll(
    'button, [role="button"], input[type="checkbox"], [role="checkbox"]'
  )).filter(visible).flatMap((element) => {
    const checkbox = element.matches('input[type="checkbox"], [role="checkbox"]');
    const text = normalize(element);
    let kind;
    if (/^Study Group(?: Filter)?(?:\s|$)/i.test(text)) kind = 'study_group';
    else if (popup?.contains(element) && checkbox) kind = 'checkbox';
    else if (popup?.contains(element) && text === 'Apply') kind = 'apply';
    else if (popup?.contains(element) && text === 'Cancel') kind = 'cancel';
    if (!kind) return [];
    return [{
      kind, path: controlPath(element),
      checked: checkbox ? (element.matches('input') ? element.checked :
        element.getAttribute('aria-checked') === 'true') : null,
      mixed: checkbox && (element.matches('input') ? element.indeterminate :
        element.getAttribute('aria-checked') === 'mixed'),
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
    }];
  }).slice(0, 60);
  const popupNodes = popup ? Array.from(popup.querySelectorAll(
    'input, label, [role="checkbox"], [role="option"], [class*="check"], [class*="Check"]'
  )) : [];
  const customControls = popupNodes.slice(0, 80).map((element) => ({
    path: controlPath(element),
    signature: [element.tagName, ...Array.from(element.classList)
      .filter((token) => /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(token)).slice(0, 10)].join(' '),
    visible: visible(element),
    checked: element.matches('input[type="checkbox"]') ? element.checked :
      element.hasAttribute('aria-checked') ? element.getAttribute('aria-checked') === 'true' : null,
    selected: element.hasAttribute('aria-selected') ? element.getAttribute('aria-selected') === 'true' : null,
  }));
  const filterObserver = window.__k6FilterInspection;
  return {
    filterInspection: {
      popupVisible: !!popup, controls: filterControls,
      customControls, customControlsTruncated: popupNodes.length > 80,
      applications: filterObserver ? filterObserver.applications.map((entry) => ({ ...entry })) : [],
      applicationLimitReached: filterObserver?.limitReached || false,
    },
    viewport: { width: innerWidth, height: innerHeight },
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).filter(visible).slice(0, 20).map((tab) => ({
      name: tab.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
      selected: tab.getAttribute('aria-selected') === 'true',
    })),
    scrollContainers: [document.scrollingElement, ...Array.from(document.querySelectorAll('*')).filter(
      (element) => visible(element) && element.scrollHeight > element.clientHeight + 20 &&
        /auto|scroll/.test(getComputedStyle(element).overflowY)
    )].filter(Boolean).slice(0, 20).map((element) => ({
      tag: element.tagName, top: round(element.scrollTop),
      height: element.clientHeight, scrollHeight: element.scrollHeight,
    })),
    widgets,
  };
}

export async function guidedDiscovery(page, frameSelector = iframeSelector) {
  await dashboardWidget(page, frameSelector);
  const initialFrame = await (await page.$(frameSelector)).contentFrame();
  if (!initialFrame) throw new Error('Dashboard frame unavailable for filter inspection.');
  await initialFrame.evaluate(installFilterObserver);
  await page.evaluate(installDiscoveryPanel);
  console.log('LOGIN_POC_STATUS discovery_ready');
  const deadline = Date.now() + 15 * 60 * 1000;
  let captures = 0;
  try {
    while (Date.now() < deadline) {
      await page.waitForFunction(
        'document.getElementById("k6-discovery-panel") && document.getElementById("k6-discovery-panel").dataset.command',
        { timeout: Math.max(1, deadline - Date.now()) }
      );
      const command = await page.evaluate(function () {
        const panel = document.getElementById('k6-discovery-panel');
        return { command: panel.dataset.command, step: panel.dataset.step };
      });
      if (command.command === 'finish') {
        if (captures === 0) throw new Error('Discovery finished without any checkpoints.');
        console.log('LOGIN_POC_STATUS discovery_complete');
        return;
      }
      if (command.command !== 'capture' || captures >= 60) {
        throw new Error('Unexpected command or discovery checkpoint limit reached.');
      }
      const iframe = await page.$(frameSelector);
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error('Dashboard iframe detached during capture.');
      const snapshot = await frame.evaluate(dashboardSnapshot);
      captures += 1;
      console.log(`DISCOVERY_CHECKPOINT ${JSON.stringify({
        sequence: captures, step: command.step, ...snapshot,
      })}`);
      await page.evaluate(function (sequence) {
        const panel = document.getElementById('k6-discovery-panel');
        delete panel.dataset.command;
        document.getElementById('k6-discovery-status').textContent =
          'Checkpoint ' + sequence + ' captured. Continue to the next position/action.';
        for (const control of panel.querySelectorAll('button, input')) control.disabled = false;
      }, captures);
    }
    throw new Error('Discovery session expired.');
  } finally {
    if (!page.isClosed()) {
      await initialFrame.evaluate(function () {
        window.__k6FilterInspection?.stop();
        delete window.__k6FilterInspection;
      });
      await page.evaluate(function () {
        document.getElementById('k6-discovery-panel')?.remove();
      });
    }
  }
}

export { dashboardSnapshot, installDiscoveryPanel, installFilterObserver };
