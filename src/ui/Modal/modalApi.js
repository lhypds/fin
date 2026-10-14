// How many dialogs are open. Modal counts itself in and out; keys that work the page behind
// them (the ledger's arrows) ask isModalOpen and stay out of the way while one is up.
let openCount = 0;

export const isModalOpen = () => openCount > 0;

export function opened() {
  openCount += 1;
}

export function closed() {
  openCount -= 1;
}
