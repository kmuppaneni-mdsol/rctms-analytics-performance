function filterDom(command) {
  const targetName = typeof command === 'object' && command !== null ? command.target : undefined;
  if (typeof command === 'object' && command !== null) command = command.command;
  const fail = (reason) => {
    window.__k6StudyGroupGuard = reason;
    throw new Error('Study Group control guard failed; raw details withheld.');
  };
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const text = (element) => element.textContent.replace(/\s+/g, ' ').trim();
  const sameIdentity = (first, second) => first.toLowerCase() === second.toLowerCase();
  const enabled = (element) => !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true';
  const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')).filter((element) =>
    visible(element) && element.textContent.includes('Apply filters and parameters'));
  function popup() {
    const matches = dialogs();
    if (matches.length !== 1) fail('dialog');
    return matches[0];
  }
  function button(name) {
    const matches = Array.from(popup().querySelectorAll('button, [role="button"]')).filter((element) =>
      visible(element) && enabled(element) && text(element) === name);
    if (matches.length !== 1) fail('button');
    return matches[0];
  }
  function options() {
    const rows = Array.from(popup().querySelectorAll('.checkbox-list-module__singleCheckboxItem'));
    if (!rows.length || rows.length > 100) fail('option_count');
    const values = rows.map((row) => {
      const inputs = row.querySelectorAll('input[type="checkbox"].checkbox-module__nativeCheckbox');
      if (inputs.length !== 1 || !visible(row)) fail('option_structure');
      const input = inputs[0];
      const label = input.closest('label.checkbox-module__label');
      if (!label || !row.contains(label) || !text(label) || input.indeterminate) fail('option_label');
      return { key: text(label), checked: input.checked, enabled: enabled(input), input, label };
    });
    if (new Set(values.map((value) => value.key.toLowerCase())).size !== values.length) fail('duplicate_identity');
    return values;
  }
  function otherState() {
    const dialog = popup();
    return JSON.stringify({
      toggles: Array.from(dialog.querySelectorAll('input[type="checkbox"]')).filter((input) =>
        !input.closest('.checkbox-list-module__singleCheckboxItem') &&
        !input.closest('.attribute-filter-module__allCheckboxContainer')).map((input) => ({
        key: input.closest('label') ? text(input.closest('label')) : input.className,
        checked: input.checked, mixed: input.indeterminate,
      })),
      tabs: Array.from(dialog.querySelectorAll('[role="tab"]')).map((tab) => ({
        key: text(tab), selected: tab.getAttribute('aria-selected'),
      })),
    });
  }
  let state = window.__k6StudyGroup;
  function selectionIssue(desired) {
    if (!state) return 'other_state';
    const current = options();
    // Counter removal is diagnostic only: never use it to choose or restore an option.
    const withoutCounter = (value) => value.replace(/\b\d+\s+selected\b/gi, '').replace(/\s+/g, ' ').trim();
    window.__k6StudyGroupComparison = {
      originalCount: state.original.length,
      currentCount: current.length,
      exactMatchCount: state.original.filter((original) =>
        current.some((item) => item.key === original.key)).length,
      counterIndependentMatchCount: state.original.filter((original) =>
        current.some((item) => withoutCounter(item.key) === withoutCounter(original.key))).length,
      targetPresent: current.some((item) => item.key === state.target),
      auxiliaryStateMatches: otherState() === state.other,
      caseInsensitiveMatchCount: state.original.filter((original) =>
        current.some((item) => item.key.toLowerCase() === original.key.toLowerCase())).length,
      caseInsensitiveTargetCount: current.filter((item) =>
        item.key.toLowerCase() === state.target.toLowerCase()).length,
      caseInsensitiveUnique: new Set(current.map((item) => item.key.toLowerCase())).size === current.length &&
        new Set(state.original.map((item) => item.key.toLowerCase())).size === state.original.length,
    };
    if (!window.__k6StudyGroupComparison.auxiliaryStateMatches) return 'other_state';
    if (current.length !== state.original.length ||
        state.original.some((original) => !current.some((item) => sameIdentity(item.key, original.key)))) return 'option_set';
    const target = current.find((item) => sameIdentity(item.key, state.target));
    const targetChecked = desired === 'restore' ? target.checked : desired;
    for (const original of state.original) {
      const match = current.find((item) => sameIdentity(item.key, original.key));
      if (!match || match.enabled !== original.enabled ||
          match.checked !== (sameIdentity(original.key, state.target) && targetChecked ? true : original.checked)) return 'selection';
    }
    return 'none';
  }
  function verify(desired) {
    const reason = selectionIssue(desired);
    if (reason !== 'none') fail(reason);
  }
  if (command === 'open') {
    if (dialogs().length) fail('dialog');
    const triggers = Array.from(document.querySelectorAll('button, [role="button"]')).filter((element) =>
      visible(element) && enabled(element) && /^Study Group(?: Filter)?(?:\s|$)/i.test(text(element)));
    if (triggers.length !== 1) fail('trigger');
    triggers[0].click();
  } else if (command === 'choose') {
    if (state) fail('already_captured');
    const values = options();
    if (typeof targetName !== 'string' || !targetName.trim()) fail('target_missing');
    const target = values.find((value) => sameIdentity(value.key, targetName));
    if (!target) fail('target_missing');
    if (!target.enabled || target.checked) fail('target_ineligible');
    state = window.__k6StudyGroup = {
      original: values.map(({ key, checked, enabled }) => ({ key, checked, enabled })),
      target: target.key, other: otherState(),
    };
    target.label.click();
    verify(true);
  } else if (command === 'verify_applied') {
    verify(true);
  } else if (command === 'restore') {
    if (!state || otherState() !== state.other) fail('other_state');
    const values = options();
    // Accept only the target's known original or test state before changing anything.
    const target = values.find((value) => sameIdentity(value.key, state.target));
    if (!target) fail('option_set');
    verify(target.checked);
    if (target.checked) target.label.click();
    verify(false);
  } else if (command === 'verify_original') {
    verify(false);
  } else if (['applied_ready', 'original_ready', 'restore_ready'].includes(command)) {
    const reason = selectionIssue(command === 'restore_ready' ? 'restore' : command === 'applied_ready');
    window.__k6StudyGroupGuard = reason;
    return reason === 'none';
  } else if (command === 'apply' || command === 'cancel') {
    button(command === 'apply' ? 'Apply' : 'Cancel').click();
  } else if (command === 'status') {
    const observations = window.__k6FilterInspection?.applications || [];
    const last = observations.at(-1);
    return {
      popupOpen: dialogs().length !== 0, applicationCount: observations.length,
      spinnerSeen: last?.spinnerSeen || false, spinnerCleared: last?.spinnerCleared || false,
      chartMutations: last?.chartMutations || 0,
      hasOriginal: !!state,
      guardReason: window.__k6StudyGroupGuard || 'none',
      ...(window.__k6StudyGroupComparison ? { optionComparison: window.__k6StudyGroupComparison } : {}),
    };
  } else if (command === 'popup_ready') {
    const dialog = popup();
    const rows = Array.from(dialog.querySelectorAll('.checkbox-list-module__singleCheckboxItem'));
    return rows.length > 0 && !Array.from(dialog.querySelectorAll(
      '.rdLoadingIndicator, [role="progressbar"], [aria-busy="true"]'
    )).some(visible) && rows.every((row) =>
      row.querySelector('input[type="checkbox"].checkbox-module__nativeCheckbox') &&
      row.querySelector('label.checkbox-module__label') && visible(row));
  } else if (command === 'cleanup') {
    window.__k6FilterInspection?.stop();
    delete window.__k6FilterInspection;
    delete window.__k6StudyGroup;
    delete window.__k6StudyGroupGuard;
    delete window.__k6StudyGroupComparison;
  } else fail('command');
}

export { filterDom };
