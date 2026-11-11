// GET /displayhubtv/api/update/download?asset=<id>  (redirect to the APK on GitHub; the token stays here)
// Shared implementation: _shared/handlers.js (updateDownloadHandler).
import { updateDownloadHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateDownloadHandler(PRODUCTS.displayhubtv);
