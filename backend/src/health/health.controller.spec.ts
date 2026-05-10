import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  describe('check()', () => {
    it('returns an object with status: "ok"', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
    });

    it('returns an object with a timestamp field', () => {
      const result = controller.check();
      expect(result).toHaveProperty('timestamp');
    });

    it('timestamp is a valid ISO 8601 string', () => {
      const result = controller.check();
      // new Date(isoString).toISOString() must round-trip back to the same string
      const parsed = new Date(result.timestamp);
      expect(parsed.toISOString()).toBe(result.timestamp);
    });
  });
});
