import { withAuth } from 'next-auth/middleware';

/** Edge gate: authentication everywhere, staff role for /admin. Route handlers re-check. */
export default withAuth({
  callbacks: {
    authorized: ({ token, req }) => {
      if (!token) return false;
      const path = req.nextUrl.pathname;
      if (path.startsWith('/admin') || path.startsWith('/api/admin')) {
        return token.role === 'ADMIN' || token.role === 'IT_REVIEWER';
      }
      return true;
    },
  },
});

export const config = {
  matcher: ['/', '/request/:path*', '/admin/:path*', '/api/chat', '/api/requests/:path*', '/api/admin/:path*'],
};
