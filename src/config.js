/**
 * Coordinates of the Forio Epicenter project we drive.
 * From the project URL: forio.com/app/{account}/{project}
 *
 * No secrets here by design: the project is PUBLIC, so creating and driving runs
 * is anonymous. Credentials are only needed for *authoring* (uploading model
 * files), which is handled manually for now.
 */
export const FORIO = {
    account: 'ghandourroy',
    project: 'model-toolkit-project',
};

/** The model file, as uploaded to the project's `model/` folder. */
export const MODEL_FILE = 'test.xlsx';

/**
 * How many steps the test model's timeline supports.
 * `Time` is B6:N6 → columns 0..12, so 12 steps can be taken from step 0.
 */
export const MAX_STEP = 12;
