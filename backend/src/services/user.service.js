import { notFound } from '../utils/errors.js';

export function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    college: user.college,
    degree: user.degree,
    branch: user.branch,
    graduationYear: user.graduationYear,
    preferredRoles: user.preferredRoles,
    preferredLocations: user.preferredLocations,
    minCtcLpa: user.minCtcLpa === null ? null : Number(user.minCtcLpa),
    skills: user.skills,
    createdAt: user.createdAt,
  };
}

export function createUserService({ prisma }) {
  return {
    async getProfile(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('User not found');
      return toPublicUser(user);
    },

    async updateProfile(userId, changes) {
      const user = await prisma.user.update({ where: { id: userId }, data: changes }).catch((err) => {
        if (err.code === 'P2025') throw notFound('User not found');
        throw err;
      });
      return toPublicUser(user);
    },
  };
}
