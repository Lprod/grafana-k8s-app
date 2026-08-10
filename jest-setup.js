// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// @grafana/scenes lazy-loads panels via IntersectionObserver, which jsdom doesn't implement.
global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
