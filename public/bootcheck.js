(() => {
  const fallback = document.getElementById('boot-fallback');
  let hasSpecificError = false;

  const setMessage = (message) => {
    if (!fallback) return;
    fallback.textContent = message;
  };

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target && target.tagName === 'SCRIPT') {
        const src = target.getAttribute('src') || '(inline script)';
        hasSpecificError = true;
        setMessage(
          `Script failed to load:\n${src}\n\n` +
            'This usually means browser extensions, privacy shields, or CSP policy are blocking app JavaScript.',
        );
        return;
      }

      const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message || 'Unknown runtime error');
      hasSpecificError = true;
      setMessage(`Runtime error before app mount:\n${message}`);
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason || 'Unknown rejection');
    hasSpecificError = true;
    setMessage(`Unhandled promise rejection:\n${reason}`);
  });

  window.addEventListener('securitypolicyviolation', (event) => {
    hasSpecificError = true;
    setMessage(
      `Security policy blocked a resource:\n` +
        `directive: ${event.violatedDirective}\n` +
        `blocked: ${event.blockedURI || '(inline)'}\n\n` +
        'A browser extension or policy is preventing app scripts from running.',
    );
  });

  window.setTimeout(() => {
    if (window.__NEXUS_BOOTED__) return;
    if (hasSpecificError) return;

    if (!window.__NEXUS_MODULE_OK__) {
      setMessage(
        'Nexus module scripts are blocked before app start.\n\n' +
          'This is usually caused by an extension, browser shield, or enterprise policy blocking module execution on localhost.',
      );
      return;
    }

    setMessage(
      'Nexus scripts started but app boot did not complete.\n\n' +
        'Next step: open DevTools Console and share the first red error line.',
    );
  }, 4000);
})();
