// POST /displayhubtv/api/update  (SmartMed Display Hub TV app: which version this TV is offered)
// Shared implementation: _shared/handlers.js (updateHandler). This product is updates-only: the first check also
// creates the TV's record, so it can be marked "Test TV" in the dashboard.
import { updateHandler } from './_shared/handlers.js';
import { PRODUCTS } from './_shared/products.js';

export default updateHandler(PRODUCTS.displayhubtv);
