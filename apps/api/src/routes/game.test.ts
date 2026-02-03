import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameRoutes } from './game.js';

describe('Game Routes Validation', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify().withTypeProvider<ZodTypeProvider>();
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);

    // Mock database for testing validation only
    await fastify.register(gameRoutes, { prefix: '/game' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  describe('POST /game/new', () => {
    it('should reject invalid character type', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/new',
        payload: {
          playerName: 'TestPlayer',
          character: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toContain('character');
      expect(body.message).toContain('dwarf');
    });

    it('should reject missing playerName', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/new',
        payload: {
          character: 'dwarf',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('message');
    });

    it('should reject empty playerName', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/new',
        payload: {
          playerName: '',
          character: 'dwarf',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toContain('playerName');
      expect(body.message).toContain('Name is required');
    });

    it('should reject missing character', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/new',
        payload: {
          playerName: 'TestPlayer',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('message');
    });
  });

  describe('POST /game/:id/move', () => {
    it('should reject invalid direction', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/test-id/move',
        payload: {
          direction: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.message).toContain('direction');
      expect(body.message).toContain('up');
    });

    it('should reject missing direction', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/test-id/move',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('message');
    });

    it('should reject numeric direction', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/test-id/move',
        payload: {
          direction: 123,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('message');
    });
  });
});
