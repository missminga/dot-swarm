// DSH browser ABI: the host owns React and the sidebar/main slots.
window.__ModuleLoader__.load({
  id: 'dsh-dot-swarm',
  factory(require) {
    const h = require('react').createElement;
    const panel = 'dot-swarm';
    function Icon({ size = 22 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M12 5 5 19h14Z' }), ...[[12,5],[5,19],[19,19]].map(([cx,cy]) => h('circle', { key: cx, cx, cy, r: 3, fill: 'currentColor' })));
    }
    function Panel() {
      return h('section', { style: { padding: 32, maxWidth: 640 } },
        h('h1', null, 'Dot Swarm'),
        h('p', null, 'Native Codex + Kimi characters. Flat assignments and small squads, in one quiet workspace.'),
        h('a', { href: 'http://127.0.0.1:4317', target: '_blank', rel: 'noreferrer', style: { color: 'inherit', textDecoration: 'underline' } }, 'Open character panel ↗'),
        h('p', null, 'The plugin serves the panel on this computer. If it is unavailable, check the Dot Swarm host log.'));
    }
    return { inject: ['slots'], apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, inject: () => ({}) }, Panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 15, label: 'Dot Swarm' }, Icon));
    } };
  },
});
