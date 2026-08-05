import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { env } from 'process';
import { PrismaService } from 'src/prisma.service';

const GOOGLE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  photo_url: true,
  google_token_id: true,
};

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /*
   * Único punto del código autorizado a leer la columna password.
   * El resultado NO sale de este método: sólo se usa para comparar.
   */
  async signIn(
    email: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, password: true },
    });
    if (user?.password !== password) {
      throw new UnauthorizedException();
    }
    const payload = { id: user.id, email: user.email };
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  async googleLogin(credential: string): Promise<{ access_token: string }> {
    let ticket: LoginTicket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID,
      });
    } catch {
      throw new UnauthorizedException();
    }
    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email || !googlePayload.email_verified) {
      throw new UnauthorizedException();
    }
    const { email, name, picture, sub } = googlePayload;

    let user = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { google_token_id: sub }] },
      select: GOOGLE_USER_SELECT,
    });

    if (user) {
      const data: Record<string, string> = {};
      if (!user.name && name) data.name = name;
      if (!user.photo_url && picture) data.photo_url = picture;
      if (!user.google_token_id) data.google_token_id = sub;
      if (Object.keys(data).length > 0) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data,
          select: GOOGLE_USER_SELECT,
        });
      }
    } else {
      const defaultRole = await this.prisma.role.findUnique({
        where: { name: 'user' },
      });
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          photo_url: picture,
          google_token_id: sub,
          ...(defaultRole && { role: { connect: { id: defaultRole.id } } }),
        },
        select: GOOGLE_USER_SELECT,
      });
    }

    const jwtPayload = { id: user.id, email: user.email };
    return {
      access_token: await this.jwtService.signAsync(jwtPayload),
    };
  }
}
