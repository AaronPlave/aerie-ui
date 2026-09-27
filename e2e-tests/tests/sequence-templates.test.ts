import test, { expect } from '@playwright/test';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';
import { AppNav } from '../fixtures/AppNav.js';
import { Constraints } from '../fixtures/Constraints.js';
import { Dictionaries } from '../fixtures/Dictionaries.js';
import { Models } from '../fixtures/Models.js';
import { Parcels } from '../fixtures/Parcels.js';
import { PanelNames, Plan } from '../fixtures/Plan.js';
import { Plans } from '../fixtures/Plans.js';
import { SchedulingConditions } from '../fixtures/SchedulingConditions.js';
import { SchedulingGoals } from '../fixtures/SchedulingGoals.js';
import { SequenceTemplates } from '../fixtures/SequenceTemplates.js';
import { setupTest, teardownTest, type BrowserSetupResult } from '../utilities/api.js';

const sequenceFilterName: string = uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals] });
const sequenceTemplateName: string = uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals] });
const sequenceTemplateContent: string = '/C Example_Command "ARG1"';
const sequenceTemplateOutputContent: string = 'C Example_Command "ARG1"';
const sequenceTemplateLanguage: string = 'SeqN';
const generatedSequenceId: string = 'E2E_GENERATED';

let setup: BrowserSetupResult;
let appNav: AppNav;
let constraints: Constraints;
let sequenceTemplates: SequenceTemplates;
let dictionaries: Dictionaries;
let dictionaryName: string;
let models: Models;
let parcels: Parcels;
let plan: Plan;
let plans: Plans;
let schedulingConditions: SchedulingConditions;
let schedulingGoals: SchedulingGoals;

test.beforeAll(async ({ baseURL, browser }) => {
  setup = await setupTest(browser, { model: false });
  appNav = new AppNav(setup.page);

  models = new Models(setup.page);
  await models.goto();
  await models.createModel(baseURL);

  plans = new Plans(setup.page, models);
  constraints = new Constraints(setup.page);
  schedulingConditions = new SchedulingConditions(setup.page);
  schedulingGoals = new SchedulingGoals(setup.page);
  plan = new Plan(setup.page, plans, constraints, schedulingGoals, schedulingConditions);
  await plans.goto();
  await plans.createPlan();
  await plan.goto();
  await plan.addActivityByDragAndDrop('PeelBanana');
  await plan.showPanel(PanelNames.SIMULATION, true);
  await plan.runSimulation();

  dictionaries = new Dictionaries(setup.page);
  await dictionaries.goto();
  await dictionaries.createCommandDictionary();
  dictionaryName = dictionaries.commandDictionaryName;

  parcels = new Parcels(setup.page);
  await parcels.goto();
  await parcels.createParcel(dictionaryName, baseURL);

  sequenceTemplates = new SequenceTemplates(setup.page, parcels, models);
});

test.afterAll(async () => {
  await plans.goto();
  await plans.deletePlan();
  await models.goto();
  await models.deleteModel();
  await parcels.goto();
  await teardownTest(setup);
});

test.describe.serial('Sequence Templates', () => {
  test(`Clicking on the app menu 'Sequence Templates' option should route to the sequence templates page`, async ({
    baseURL,
  }) => {
    await appNav.appMenuButton.click();
    await appNav.appMenu.waitFor({ state: 'attached' });
    await appNav.appMenu.waitFor({ state: 'visible' });
    await appNav.appMenuItemSequenceTemplates.click();
    await expect(setup.page).toHaveURL(`${baseURL}/sequence-templates`);
  });
  test('Create new sequence template', async () => {
    await sequenceTemplates.goto();
    await sequenceTemplates.createSequenceTemplate(sequenceTemplateName, sequenceTemplateLanguage);
  });
  test('Open and modify a sequence via form editor', async () => {
    await sequenceTemplates.goto();
    await sequenceTemplates.updateSequenceTemplate(sequenceTemplateName, sequenceTemplateContent);
  });
  test('Sequence Templating can be run', async () => {
    // Backend JAR-based sequence expansion is legitimately slow; the toast below waits up to 30s,
    // which cannot fit inside the 30s default test budget once the setup steps are counted. Give
    // this test its own generous budget so the slow-but-valid expansion has room to complete.
    test.setTimeout(90000);
    await plan.goto();
    await plan.showPanel(PanelNames.EXPANSION);
    await plan.createSequenceFilter(sequenceFilterName);
    await plan.applySequenceFilter(sequenceFilterName, plans.planId);

    // can expand either by clicking the "Expand Sequence" button on the sequence row, or "Expand All" in the panel
    const expansionSequenceItem = setup.page.locator('.sne-items').getByText(`${sequenceFilterName} Sequence`);
    await expansionSequenceItem.hover();
    const expandSequenceButton = setup.page.getByLabel('Expand Sequence');
    await expect(expandSequenceButton).toBeVisible();
    await expect(expandSequenceButton).toBeEnabled();

    const expandAllButton = setup.page.getByRole('button', { name: 'Expand All' });
    await expect(expandAllButton).toBeEnabled();
    await expandAllButton.click();

    // Sequence templating can take a while - increase timeout to 30 seconds
    await plan.waitForToast('Sequence Templating Succeeded', 30000);
    await expansionSequenceItem.hover();
    await setup.page.getByLabel('Show Expanded Sequence').click();

    await plan.sequenceExpansionOutputModal.waitFor({ state: 'attached' });
    await plan.sequenceExpansionOutputModal.waitFor({ state: 'visible' });
    await setup.page.getByText('Loading Editor...').waitFor({ state: 'detached' });
    await expect(plan.sequenceExpansionOutputModal.getByText(sequenceTemplateOutputContent)).toBeVisible();
  });
  test('Sequence can be generated from selected activities', async () => {
    test.setTimeout(90000);
    await plan.goto();
    await plan.showPanel(PanelNames.SEQUENCES);
    await setup.page.getByTestId('generate-sequence-button').click();

    const modal = setup.page.getByTestId('generate-sequence-modal');
    await expect(modal.getByTestId('generate-sequence-source')).toContainText('complete');
    await modal.getByTestId('generate-sequence-activities').getByRole('checkbox').first().check();
    await modal.locator('input[name="sequence-id"]').fill(generatedSequenceId);
    await expect(modal.getByTestId('generate-sequence-coverage')).toContainText('1 / 1 supported');
    await setup.page.getByTestId('generate-sequence-submit').click();

    await expect(
      setup.page.locator('.toastify').filter({ hasText: `Sequence "${generatedSequenceId}" Generated` }),
    ).toBeVisible({ timeout: 30000 });
    const details = setup.page.getByTestId('sequence-generation-details');
    await details.waitFor({ state: 'visible' });
    await setup.page.getByText('Loading Editor...').waitFor({ state: 'detached' });
    await expect(details.getByText(sequenceTemplateOutputContent)).toBeVisible();
    await setup.page.getByRole('button', { exact: true, name: 'Close' }).click();

    const generation = setup.page.getByTestId('sequence-generation').filter({ hasText: generatedSequenceId }).first();
    await expect(generation).toContainText('Generated');

    const downloadPromise = setup.page.waitForEvent('download');
    await generation.getByRole('button', { name: `Export '${generatedSequenceId}'` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toEqual(`${generatedSequenceId}.seqN.txt`);
  });
  test('Delete a sequence template', async () => {
    await sequenceTemplates.goto();
    await sequenceTemplates.deleteSequenceTemplate(sequenceTemplateName);
  });
});
