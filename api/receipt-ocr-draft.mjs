import {createDraftHandler} from '../server/receipt-ocr-draft.mjs';
export const config={api:{bodyParser:false}};
export default createDraftHandler();
