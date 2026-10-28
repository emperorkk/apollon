// Progressive enhancement for the share bars on server-rendered report
// pages (src/web/render.js shareBar). The plain share links work without
// JS; this adds the native share sheet (mobile) and copy-to-clipboard.
(function () {
  const canNativeShare = typeof navigator.share === 'function';

  document.querySelectorAll('.share').forEach((bar) => {
    const url = bar.dataset.shareUrl;
    const title = bar.dataset.shareTitle;

    const native = bar.querySelector('.share-native');
    if (native && canNativeShare) {
      native.hidden = false;
      native.addEventListener('click', () => {
        navigator.share({ title, text: title, url }).catch(() => {});
      });
    }

    const copy = bar.querySelector('.share-copy');
    if (copy) {
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        copy.textContent = 'Copied!';
        copy.classList.add('copied');
        setTimeout(() => {
          copy.textContent = 'Copy link';
          copy.classList.remove('copied');
        }, 2000);
      });
    }
  });
})();
