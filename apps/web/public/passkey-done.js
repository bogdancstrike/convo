// Shows the outcome Keycloak reports for a passkey action (kc_action_status: success | cancelled
// | error). Convo prefixes `state` with "add." or "remove."; anything unexpected keeps the
// "did not finish" text.
(function () {
  var query = new URLSearchParams(window.location.search);
  var status = query.get('kc_action_status');
  var kind = (query.get('state') || '').indexOf('remove.') === 0 ? 'remove' : 'add';
  if (status !== 'success' && status !== 'cancelled') return;
  document.querySelectorAll('section[data-status]').forEach(function (section) {
    var sectionKind = section.getAttribute('data-kind');
    section.hidden = section.getAttribute('data-status') !== status || (sectionKind !== null && sectionKind !== kind);
  });
}());
