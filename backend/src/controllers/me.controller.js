import { updateProfileSchema } from '../validators/user.validators.js';

export function createMeController({ userService }) {
  return {
    async get(req, res) {
      res.json({ data: await userService.getProfile(req.user.id) });
    },

    async update(req, res) {
      const changes = updateProfileSchema.parse(req.body);
      res.json({ data: await userService.updateProfile(req.user.id, changes) });
    },
  };
}
