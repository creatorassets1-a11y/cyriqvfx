import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate } from '../middleware/index.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../lib/crypto.js';
import { attachUser, createSession, destroySession, requireAuth, stripUser } from '../middleware/auth.js';
import { sendEmail } from '../modules/email.js';
import { recordAudit } from '../modules/audit.js';
import { privateNoStore } from '../middleware/cache.js';
import { logger } from '../lib/logger.js';

export const authRouter = Router();
authRouter.use(privateNoStore);

const EMAIL_TOKEN_TTL_MS = 60 * 60 * 1000;

const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((v) => !/^\s|\s$/.test(v), 'Password cannot start or end with a space.');

const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    username: z
      .string()
      .trim()
      .min(3, 'Usernames need at least 3 characters.')
      .max(24, 'Usernames are limited to 24 characters.')
      .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers and underscores only.'),
    displayName: z.string().trim().min(1).max(50).optional(),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Those passwords do not match.',
    path: ['confirmPassword'],
  });

authRouter.post(
  '/register',
  limiters.register,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, username, password, displayName } = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      throw badRequest('That account already exists.', [
        existing.email === email
          ? { field: 'email', message: 'An account already uses that email.' }
          : { field: 'username', message: 'That username is taken.' },
      ]);
    }

    const user = await prisma.user.create({
      data: {
        email,
        username,
        displayName: displayName || username,
        passwordHash: await hashPassword(password),
        preference: { create: {} },
      },
    });

    // Verification is required to unlock email notifications, but never blocks
    // browsing or downloading, which work without an account at all.
    const token = generateToken(24);
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });
    sendEmail({
      to: user.email,
      subject: 'Confirm your email',
      heading: 'Confirm your email',
      body: 'Confirm your address to turn on resource update notifications. Your downloads work either way.',
      ctaLabel: 'Confirm email',
      ctaPath: `/verify-email?token=${token}`,
      footnote: 'If you did not create this account, you can ignore this message.',
    }).catch((err) => logger.error({ err }, 'verification email failed'));

    await createSession(user.id, req, res);
    res.status(201).json({ user: stripUser(user) });
  }),
);

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username.'),
  password: z.string().min(1, 'Enter your password.'),
});

authRouter.post(
  '/login',
  limiters.auth,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as z.infer<typeof loginSchema>;
    const lookup = identifier.toLowerCase();

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: lookup }, { username: identifier }] },
    });

    // Same message and comparable timing whether the account exists or not.
    const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000', password);

    if (!user || !ok) {
      if (user?.role === 'ADMIN') {
        await recordAudit({
          req,
          actorId: user.id,
          actorLabel: user.email,
          action: 'admin.login_failed',
          metadata: { reason: 'bad_password' },
        });
      }
      throw unauthorized('That email or password is not right.');
    }

    if (user.status === 'SUSPENDED') {
      throw forbidden('This account is suspended. Contact the site owner if you think that is a mistake.');
    }
    if (user.status === 'DELETED') {
      throw unauthorized('That email or password is not right.');
    }

    await createSession(user.id, req, res);

    if (user.role === 'ADMIN') {
      await recordAudit({ req, actorId: user.id, actorLabel: user.email, action: 'admin.login' });
    }

    res.json({ user: stripUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await destroySession(req, res);
    res.status(204).end();
  }),
);

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
});

authRouter.post(
  '/forgot-password',
  limiters.passwordReset,
  validate(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotSchema>;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always the same response, so the endpoint never reveals who has an account.
    if (user && user.status === 'ACTIVE') {
      await prisma.emailToken.updateMany({
        where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: new Date() },
      });
      const token = generateToken(24);
      await prisma.emailToken.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
        },
      });
      sendEmail({
        to: user.email,
        subject: 'Reset your password',
        heading: 'Reset your password',
        body: 'Use the link below to choose a new password. It expires in one hour.',
        ctaLabel: 'Choose a new password',
        ctaPath: `/reset-password?token=${token}`,
        footnote: 'If you did not request this, nothing has changed on your account.',
      }).catch((err) => logger.error({ err }, 'reset email failed'));
    }

    res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  }),
);

const resetSchema = z
  .object({
    token: z.string().min(10),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Those passwords do not match.',
    path: ['confirmPassword'],
  });

authRouter.post(
  '/reset-password',
  limiters.passwordReset,
  validate(resetSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as z.infer<typeof resetSchema>;
    const record = await prisma.emailToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('That reset link has expired or already been used. Request a new one.');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(password) },
      }),
      prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Changing a password ends every existing session.
      prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);

    res.json({ ok: true, message: 'Your password has been changed. Sign in with it now.' });
  }),
);

const verifySchema = z.object({ token: z.string().min(10) });

authRouter.post(
  '/verify-email',
  limiters.auth,
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const { token } = req.body as z.infer<typeof verifySchema>;
    const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });

    if (!record || record.type !== 'EMAIL_VERIFICATION' || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('That confirmation link has expired. Request a new one from your account settings.');
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    res.json({ ok: true, message: 'Email confirmed.' });
  }),
);

authRouter.post(
  '/resend-verification',
  limiters.passwordReset,
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.emailVerifiedAt) {
      return res.json({ ok: true, message: 'Your email is already confirmed.' });
    }
    const token = generateToken(24);
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });
    await sendEmail({
      to: user.email,
      subject: 'Confirm your email',
      heading: 'Confirm your email',
      body: 'Confirm your address to turn on resource update notifications.',
      ctaLabel: 'Confirm email',
      ctaPath: `/verify-email?token=${token}`,
    });
    res.json({ ok: true, message: 'Confirmation sent. Check your inbox.' });
  }),
);
