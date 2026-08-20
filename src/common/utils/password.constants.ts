// Reused everywhere a new password is accepted (create user, self change,
// admin/instructor reset) — matches the minimum already enforced by
// CreateUserDto before this feature existed.
export const PASSWORD_MIN_LENGTH = 6;
