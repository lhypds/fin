// A receipt in flight: a card dragged from the panel onto a ledger row to match it, or a chip
// dragged from a row back onto the panel to unmatch it. Kept apart from the component so the
// ledger can import it without the panel losing fast refresh.
export const RECEIPT_DRAG_TYPE = "application/x-receipt";

// True for a drag carrying a receipt id.
export const isReceiptDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(RECEIPT_DRAG_TYPE);
