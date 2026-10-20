// Any unknown /displayhub/api/... address: a JSON error the Display Hub app can read (not the dashboard's HTML page).
// Shared implementation: _shared/handlers.js (notFoundHandler).
import { notFoundHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default notFoundHandler(PRODUCTS.displayhub);
