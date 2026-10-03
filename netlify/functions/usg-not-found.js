// Any unknown /usg/api/... address: a JSON error the desktop app can read (instead of the dashboard's HTML page).
import { fail } from './_shared/usg.js';

export default async function () {
  return fail(404, 'not_found', 'This licence server address is not answering correctly. Please update the app or contact support.');
}
