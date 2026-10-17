import { createContext, useContext } from 'react';

// Signed-in staff member and app settings, shared by every page.
export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
