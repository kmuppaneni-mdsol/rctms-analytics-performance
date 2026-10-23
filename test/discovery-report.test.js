import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryCheckpoint } from '../lib/discovery-report.js';

function fixture() {
  return {
    sequence: 1, step: 'initial_viewport',
    viewport: { width: 1280, height: 720 },
    tabs: [{ name: 'Summary', selected: true }],
    scrollContainers: [{ tag: 'HTML', top: 0, height: 720, scrollHeight: 1800 }],
    widgets: [],
  };
}

test('discovery report projects allowed fields, excluding raw data and credentials', () => {
  assert.deepEqual(discoveryCheckpoint({
    ...fixture(), cookies: 'not-for-output', password: 'not-for-output', data: ['not-for-output'],
  }), fixture());
});

test('discovery rejects unexpected labels, malformed metadata, and oversized arrays', () => {
  for (const change of [
    { step: 'a secret' }, { sequence: 0 }, { viewport: { width: NaN, height: 720 } },
    { tabs: [{ name: 'invalid\nlabel', selected: true }] },
    { widgets: Array(101).fill({}) },
    { scrollContainers: [{ tag: 'HTML', top: -1, height: 720, scrollHeight: 1800 }] },
  ]) {
    assert.throws(() => discoveryCheckpoint({ ...fixture(), ...change }));
  }
});

test('filter control inspection projects only structural paths and boolean states', () => {
  const control = { kind: 'checkbox', path: 'html > body:nth-of-type(1) > input:nth-of-type(1)',
    checked: true, mixed: false, disabled: false };
  const value = { ...fixture(), step: 'filter_open',
    filterInspection: { popupVisible: true, controls: [{ ...control, value: 'PRIVATE_VALUE', text: 'PRIVATE_LABEL' }] } };
  assert.deepEqual(discoveryCheckpoint(value).filterInspection, { popupVisible: true, controls: [control] });
  for (const change of [{ path: '[value="PRIVATE_VALUE"]' }, { checked: 'PRIVATE_VALUE' }, { kind: 'PRIVATE_VALUE' }]) {
    assert.throws(() => discoveryCheckpoint({ ...value,
      filterInspection: { popupVisible: true, controls: [{ ...control, ...change }] } }));
  }
});

test('custom controls and refresh observations exclude raw data and reject malformed output', () => {
  const custom = { path: 'html > body:nth-of-type(1) > input:nth-of-type(1)',
    signature: 'INPUT custom-checkbox', visible: false, checked: true, selected: null };
  const entry = { index: 1, elapsedMs: 400, spinnerSeen: true, spinnerCleared: true,
    chartMutations: 3, observationExpired: false };
  const filterInspection = {
    popupVisible: true, controls: [], customControls: [custom], customControlsTruncated: false,
    applications: [entry], applicationLimitReached: false,
  };
  const result = discoveryCheckpoint({ ...fixture(), filterInspection: {
    ...filterInspection, customControls: [{ ...custom, value: 'PRIVATE' }],
    applications: [{ ...entry, response: 'PRIVATE' }],
  } });
  assert.deepEqual(result.filterInspection, filterInspection);
  for (const bad of [
    { customControls: [{ ...custom, checked: 'PRIVATE' }] },
    { customControls: Array(81).fill(custom) },
    { applications: [{ ...entry, elapsedMs: 120001 }] },
    { applications: [{ ...entry, index: 2 }] },
    { applications: [{ ...entry, chartMutations: -1 }] },
    { applications: [{ ...entry, spinnerSeen: 'PRIVATE' }] },
  ]) {
    assert.throws(() => discoveryCheckpoint({ ...fixture(),
      filterInspection: { ...filterInspection, ...bad } }));
  }
});
