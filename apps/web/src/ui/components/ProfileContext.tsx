import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { UserProfile } from '../../core/profile';
const Profiles = createContext(new Map<string, UserProfile>());
export function ProfilesProvider({ client, children }: { client: EnclaveClient; children: ReactNode }) {
  const [profiles, setProfiles] = useState(() => client.profiles());
  useEffect(() => client.on('profiles', setProfiles), [client]);
  return <Profiles.Provider value={profiles}>{children}</Profiles.Provider>;
}
export function useProfile(id: string): UserProfile | undefined { return useContext(Profiles).get(id); }
