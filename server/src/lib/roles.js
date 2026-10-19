// The four logins of the app, from most to least access. Shared by the server (checks) and the
// screens (labels, what to show), so both always agree.
//
//   App owner      the person who built and looks after the app (support and set-up access)
//   Store owner    the shop's owner: connects WhatsApp, goes live, shop details, manages logins
//   Store manager  runs the day: sends messages, templates, special days, imports customers
//   Staff          the counter: adds customers, answers replies, calls back, records sales codes
//
// Each role can do everything the roles below it can. "At least" levels are used everywhere.
export const ROLES = ['app_owner', 'owner', 'manager', 'staff'];

export const ROLE_INFO = {
  app_owner: {
    level: 4,
    label: 'App owner',
    who: 'The person who built and looks after the app',
    can: 'Everything the store owner can do, plus creating and resetting the store owner’s login. Used for set-up and support.',
  },
  owner: {
    level: 3,
    label: 'Store owner',
    who: 'The shop’s owner',
    can: 'Connects WhatsApp and goes live, edits the shop details and message limits, approves big sends, manages manager and staff logins, downloads the shop’s data.',
  },
  manager: {
    level: 2,
    label: 'Store manager',
    who: 'Runs the shop day to day',
    can: 'Sends messages, writes templates, sets up special days and wishes, imports and deletes customers. Big sends wait for the store owner’s OK.',
  },
  staff: {
    level: 1,
    label: 'Staff',
    who: 'Counter and floor staff',
    can: 'Adds and edits customers, answers replies, calls back interested customers, records sales codes, sees the reports. Cannot send messages.',
  },
};

export const roleLevel = (role) => ROLE_INFO[role]?.level || 0;
export const roleLabel = (role) => ROLE_INFO[role]?.label || 'Staff';

/** True when `role` is `min` or higher. */
export const atLeast = (role, min) => roleLevel(role) >= roleLevel(min);

/** True when someone with role `actor` may change a login that has role `target` (only below themselves). */
export const canManageRole = (actor, target) => roleLevel(target) < roleLevel(actor);

/** The roles `actor` may give to a login they create or change. The app owner login is never made in the app. */
export const assignableRoles = (actor) => ROLES.filter((r) => r !== 'app_owner' && canManageRole(actor, r));
