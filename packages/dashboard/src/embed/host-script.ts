export const AUTO_RESIZE_SCRIPT = `<script>
(function() {
  function aiusageFrames() {
    return Array.prototype.slice.call(document.querySelectorAll('iframe[src*="/embed?"]'));
  }

  function frameThemeIsAuto(frame) {
    try {
      var url = new URL(frame.src, location.origin);
      var theme = url.searchParams.get('theme');
      return theme !== 'light' && theme !== 'dark';
    } catch(err) {
      return false;
    }
  }

  function readHostTheme() {
    var root = document.documentElement;
    var body = document.body;
    var value = ((root && root.getAttribute('data-theme')) || (body && body.getAttribute('data-theme')) || '').toLowerCase();
    if ((root && root.classList.contains('dark')) || (body && body.classList.contains('dark')) || value === 'dark') return 'dark';
    if ((root && root.classList.contains('light')) || (body && body.classList.contains('light')) || value === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncHostTheme() {
    var theme = readHostTheme();
    aiusageFrames().forEach(function(frame) {
      if (frameThemeIsAuto(frame) && frame.contentWindow) {
        frame.contentWindow.postMessage({ source: 'aiusage-host', theme: theme }, '*');
      }
    });
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.source === 'aiusage-embed' && e.data.height) {
      aiusageFrames().forEach(function(f) {
        if (f.contentWindow === e.source) {
          f.setAttribute('scrolling', 'no');
          f.style.overflow = 'hidden';
          f.style.height = Math.ceil(e.data.height) + 'px';
          syncHostTheme();
        }
      });
    }
  });

  var observer = new MutationObserver(syncHostTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  if (window.matchMedia) {
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mql.addEventListener) mql.addEventListener('change', syncHostTheme);
    else if (mql.addListener) mql.addListener(syncHostTheme);
  }
  window.addEventListener('load', syncHostTheme);
  syncHostTheme();
})();
</script>`;
