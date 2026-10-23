export const initialWidgets = [
  [
    'Study Environments with Visit Counts', 'No. of remaining visits to complete',
    'Visits by Type', 'Visit Report Tracking', 'Visits by Status', 'Overall Visit Conduct Summary',
  ],
  ['Site Communication Visit by CRA', 'Site Communication Visit by Status'],
  ['Visit Report Tracking Status Summary', 'Visit Types by CRA',
    'Visit Types and Visit Status by CRA', 'Visit Status by CRA'],
  ['Summary Table'],
];

export function journeyPlan(inventory) {
  if (inventory.tabs.length !== 4) throw new Error('Expected the four discovered dashboard tabs.');
  return inventory.tabs.map((tab, index) => {
    if (!initialWidgets[index].every((title) => tab.widgets.includes(title))) {
      throw new Error('Initial viewport widgets do not match the discovered inventory.');
    }
    return { name: tab.name, widgets: [...tab.widgets], initialWidgets: [...initialWidgets[index]] };
  });
}
