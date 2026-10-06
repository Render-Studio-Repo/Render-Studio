/** Keep secondary links available without squeezing the phone's action bar. */
export function initMobileLayout() {
  const social = document.querySelector('#mobile-app-banner .mobile-app-banner-social');
  const card = document.querySelector('#mobile-more-sheet .mobile-more-sheet-card');
  if (!social || !card) return;
  const anchor = document.createComment('mobile social links'); social.before(anchor);
  const mq = window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)');
  const sync = () => {
    if (mq.matches) card.append(social);
    else anchor.after(social);
  };
  sync(); mq.addEventListener('change', sync);
}
