// Any other /displayhubtv/api/... address: a JSON error the TV app can read, never the dashboard's HTML.
// Shared implementation: _shared/handlers.js (notFoundHandler).
import { notFoundHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default notFoundHandler(PRODUCTS.displayhubtv);
