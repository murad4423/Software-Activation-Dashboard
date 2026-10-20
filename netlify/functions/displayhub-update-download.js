// GET /displayhub/api/update/download?asset=<id>  (Display Hub app: redirect to the package on GitHub)
// Shared implementation: _shared/handlers.js (updateDownloadHandler).
import { updateDownloadHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateDownloadHandler(PRODUCTS.displayhub);
