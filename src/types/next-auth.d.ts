import type { OpCo, Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      name: string;
      email: string;
      opco: OpCo | null;
      department: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid: string;
    role: Role;
    opco?: OpCo | null;
    department?: string | null;
  }
}
