// jsdom does not implement the native dialog top layer. Browser QA covers
// focus trapping and Escape; component tests use its open/close contract.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
}
