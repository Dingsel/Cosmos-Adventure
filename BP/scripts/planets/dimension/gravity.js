import { world, system, DimensionTypes } from "@minecraft/server";
export { Gravity };



/**
 * ✨💕 LUM STUDIO GRAVITY SYSTEM (2022-2025) 💕✨
 *
 * Created with love and passion by LUM STUDIO. @ARR
 *
 * @author REFRACTED
 */

// --- Shared State using WeakMaps ---
/** @type {WeakMap<any, boolean>} */
const playerJumpMap = new WeakMap();
/** @type {WeakMap<any, number>} */
const jumpStartY = new WeakMap();
/** @type {WeakMap<any, number>} */
const pendingJumpSteps = new WeakMap();
/** @type {WeakMap<any, number>} */
const fallVelocity = new WeakMap();

/**
 * Class representing a custom gravity system for an entity.
 */
class Gravity {
  /**
   * Creates a Gravity instance.
   * @param {any} entity - The Minecraft entity.
   */
  constructor(entity) {
    this._entity = entity;
  }

  /**
   * Gets the underlying entity.
   * @return {any} The entity.
   */
  get entity() {
    return this._entity;
  }

  /**
   * Retrieves the current gravity value.
   * Checks for a temporary override or dynamic property; defaults to 9.8.
   * @return {number} The gravity value.
   */
  get value() {
    if (this.entity.tempGravityValue !== undefined) {
      return Number(this.entity.tempGravityValue) || 9.8;
    }
    if (typeof this.entity.getDynamicProperty === "function") {
      const dyn = this.entity.getDynamicProperty("sert:gravity");
      if (dyn !== undefined && dyn !== null) return Number(dyn) || 9.8;
    }
    return 9.8;
  }

  /**
   * Validates a gravity value.
   * @param {number} value - The gravity value.
   * @return {boolean} True if valid.
   */
  canSet(value) {
    return typeof value === "number" && value > 0 && !isNaN(value) && value !== Infinity;
  }

  /**
   * Sets a permanent gravity value on the entity.
   * @param {number} value - The gravity value.
   */
  set(value) {
    if (!this.canSet(value)) {
      throw new Error(
        "Failed to set gravity value(" +
          value +
          ") for " +
          this.entity.typeId +
          " (use Gravity.canSet)"
      );
    }
    if (typeof this.entity.setDynamicProperty === "function") {
      this.entity.setDynamicProperty("sert:gravity", value);
    }
  }

  /**
   * Sets a temporary gravity value on the entity.
   * @param {number} value - The temporary gravity value.
   */
  setTemp(value) {
    if (!this.canSet(value)) {
      throw new Error(
        "Failed to set gravity value(" +
          value +
          ") for " +
          this.entity.typeId +
          " (use Gravity.canSet)"
      );
    }
    this.entity.tempGravityValue = value;
  }

  /**
   * Sets the gravity "line" for jump smoothing.
   * @param {number[]} [line=[1]] - The array of impulse values.
   */
  setGravityLine(line = [1]) {
    if (!Array.isArray(this.entity.gravityLine)) {
      this.entity.gravityLine = [];
    }
    this.entity.gravityLine = line.concat(this.entity.gravityLine.slice(line.length - 1));
  }

  /**
   * Computes the gravity vector for the entity.
   * Incorporates jump smoothing and horizontal adjustments.
   * @return {Object} An object with properties x, y, z, and hzPower.
   */
  calculateGravityVector() {
    const entity = this.entity;
    const vector = { x: 0, y: -1, z: 0 };
    const power = { x: 1, y: this.value / 2, z: 1 };

    if (entity.isJumping && playerJumpMap.get(entity)) {
      playerJumpMap.set(entity, false);
      const jumpBoost =
        typeof entity.getEffect === "function" && entity.getEffect("jump_boost")
          ? Number(entity.getEffect("jump_boost").amplifier) + 1
          : 1;
      const gravityMod = Math.max(0.1, (9.8 - this.value) / 10 + 1);
      const lineLength = Math.floor(18 + (9.8 - this.value));
      const lineArray = Array.from({ length: lineLength }, (_, i) =>
        ((lineLength - i) / 6) *
        -gravityMod *
        5 *
        ((jumpBoost * 0.2 + 1)) /
        Math.max(Math.min(1, this.value), 0.005)
      );
      this.setGravityLine(lineArray);
    } else if (entity.isOnGround) {
      this.cancelPendingJumps();
      playerJumpMap.set(entity, true);
    }

    if (Array.isArray(entity.gravityLine) && entity.gravityLine.length > 0) {
      power.y += entity.gravityLine[0];
      entity.gravityLine.shift();
    }

    if (entity.inputInfo && typeof entity.inputInfo.getMovementVector === "function") {
      const movement = entity.inputInfo.getMovementVector();
      if (movement) {
        const viewDir =
          typeof entity.getViewDirection === "function"
            ? entity.getViewDirection()
            : { x: 0, y: 0, z: 0 };
        const rotation =
          typeof entity.getRotation === "function"
            ? entity.getRotation()
            : { x: 0, y: 0, z: 0 };
        const rotatedDir = getDirectionFromRotation(sumObjects(rotation, { x: 0, y: 90, z: 0 }));
        vector.x = Number(viewDir.x) * Number(movement.y) - Number(rotatedDir.x) * Number(movement.x);
        vector.z = Number(viewDir.z) * Number(movement.y) - Number(rotatedDir.z) * Number(movement.x);
      }
    }

    return {
      x: Number(vector.x),
      y: Number(power.y * vector.y),
      z: Number(vector.z),
      hzPower: this.calculateHorizontalPower(entity)
    };
  }

  /**
   * Computes horizontal movement power based on active effects.
   * @param {any} entity - The entity.
   * @return {number} The horizontal power.
   */
  calculateHorizontalPower(entity) {
    const speed =
      typeof entity.getEffect === "function" && entity.getEffect("speed")
        ? Number(entity.getEffect("speed").amplifier) + 1
        : 1;
    const slowness =
      typeof entity.getEffect === "function" && entity.getEffect("slowness")
        ? Number(entity.getEffect("slowness").amplifier) + 1
        : 1;
    const base = (speed - slowness) * 0.2 + 1;
    const modifier = 0.18 + (entity.isSprinting ? 0.2 : 0) - (entity.isSneaking ? 0.1 : 0);
    return base * modifier;
  }

  /**
   * Applies knockback to a target entity, scaled by its knockback resistance.
   * @param {any} targetEntity - The target entity.
   * @param {Object} vector - The gravity vector.
   * @param {Object} power - The power object.
   */
  applyKnockbackWithDamage(targetEntity, vector, power) {
    const knockbackResistance =
      typeof targetEntity.getEffect === "function" && targetEntity.getEffect("knockback_resistance")
        ? Number(targetEntity.getEffect("knockback_resistance").amplifier)
        : 0;
    const resistanceFactor = 1 + knockbackResistance * 0.2;
    const adjustedPower = {
      x: Number(vector.x) * Number(power.hzPower) * resistanceFactor,
      z: Number(vector.z) * Number(power.hzPower) * resistanceFactor,
      y: Number(vector.y) * Number(power.y) * resistanceFactor
    };

    if (typeof targetEntity.applyKnockback === "function") {
      targetEntity.applyKnockback(
        Number(adjustedPower.x),
        Number(adjustedPower.z),
        Number(vector.hzPower),
        Number(adjustedPower.y)
      );
    }
  }

  /**
   * Calculates the fall distance based on the stored jump start.
   * @return {number} The fall distance.
   */
  calculateFallDistance() {
    const startY = Number(jumpStartY.get(this.entity)) || 0;
    const currentY = Number(this.entity.location && this.entity.location.y) || 0;
    return Math.max(0, startY - currentY);
  }

  /**
   * Implements a custom jump by integrating an extra impulse.
   * The desired jump height is computed dynamically:
   *   desiredJumpHeight = 1.5 * (9.8 / actualGravity)^0.77
   * In normal gravity this is ~1.5 blocks; in low gravity it scales up (e.g., ~6 blocks on the Moon).
   * We compute the extra impulse required (v_desired - v_default) and distribute it over jumpTicks,
   * then scale it down by a multiplier.
   * @note This routine supplements the default jump; it does not cancel it.
   */
  applyJump() {
    const entity = this.entity;
    if (!entity.isOnGround || entity.isFlying) return;
    if (pendingJumpSteps.has(entity)) return;
  
    this.cancelPendingJumps();
    const currentY = (entity.location && typeof entity.location.y === "number")
      ? Number(entity.location.y)
      : 0;
    jumpStartY.set(entity, currentY);
  
    const h_default = 1.5;
    const v_default = Math.sqrt(2 * 9.8 * h_default);
    const desiredJumpHeight = h_default * Math.pow(9.8 / this.value, 0.77);
    const v_desired = Math.sqrt(2 * this.value * desiredJumpHeight);
    const extraImpulse = v_desired - v_default;
    const jumpTicks = 10;
    const multiplier = 0.25;
    const perTickImpulse = (extraImpulse / jumpTicks) * multiplier;
  
    const executeJumpStep = (step) => {
      // Cancel if entity lands or jump sequence finishes.
      if (entity.isOnGround || step >= jumpTicks) {
        pendingJumpSteps.delete(entity);
        return;
      }
      // Check if a block overhead is obstructing the jump (e.g., ceiling collision)
      const overheadBlock = getBlockAbove(entity);
      if (overheadBlock && overheadBlock.typeId !== "minecraft:air") {
        pendingJumpSteps.delete(entity);
        return;
      }
      // Use movement direction to check if a block is obstructing the jump.
      const moveBlock = getBlockInMovementDirection(entity);
      if (moveBlock && moveBlock.typeId !== "minecraft:air") {
        pendingJumpSteps.delete(entity);
        return;
      }
      const progress = Math.sin((step / jumpTicks) * Math.PI);
      if (typeof entity.applyKnockback === "function") {
        entity.applyKnockback(0, 0, 0, perTickImpulse * progress);
      }
      const timeoutId = system.runTimeout(() => executeJumpStep(step + 1), 1);
      pendingJumpSteps.set(entity, timeoutId);
    };
  
    executeJumpStep(0);
  }

  /**
   * Cancels any pending jump steps.
   */
  cancelPendingJumps() {
    const timeoutId = pendingJumpSteps.get(this.entity);
    if (timeoutId) {
      system.clearRun(timeoutId);
      pendingJumpSteps.delete(this.entity);
    }
  }
}


/**
 * Processes gravity for a given entity.
 * Skips processing if the entity is swimming, flying, gliding, or (if a player) wearing an elytra.
 * Also zeroes horizontal impulses in narrow spaces.
 * @param {any} entity - The entity.
 */
function gravityFuncMain(entity) {
    if (typeof entity.isValid !== "function" || !entity.isValid()) return;
    // Skip if swimming, flying, gliding...
    if (entity.isSwimming) {
      resetFallVelocity(entity);
      return;
    }
    if (entity.typeId === "minecraft:player") {
      if (entity.isFlying || entity.isGliding) {
        resetFallVelocity(entity);
        return;
      }
      // Optionally check for an elytra in the chest slot.
      const inv = entity.getComponent("minecraft:inventory");
      if (inv) {
        const chestItem = inv.container.getItem(1); // adjust slot index as needed
        if (chestItem && chestItem.typeId === "minecraft:elytra") {
          return;
        }
      }
    }
    
    const gravity = new Gravity(entity);
    if (Math.abs(gravity.value - 9.8) < 0.0001) return;
    
    const vector = gravity.calculateGravityVector();
    const currentFall = Number(fallVelocity.get(entity)) || 0;
    
    // Use movement direction check for an obstacle.
    if (
      entity.typeId === "minecraft:player" &&
      typeof entity.inputInfo?.getMovementVector === "function"
    ) {
      const block = getBlockInMovementDirection(entity);
      if (block && block.typeId !== "minecraft:air") {
        vector.x = 0;
        vector.z = 0;
      }
      // Check adjacent left and right to detect narrow spaces.
      const leftBlock = getBlockAtOffset(entity, -1, 0, 0);
      const rightBlock = getBlockAtOffset(entity, 1, 0, 0);
      if ((leftBlock && leftBlock.typeId !== "minecraft:air") ||
          (rightBlock && rightBlock.typeId !== "minecraft:air")) {
        vector.x = 0;
        vector.z = 0;
      }
    }
    
    if (!entity.isOnGround && !entity.isClimbing && !entity.isSwimming) {
      applyGravityEffects(entity, vector, currentFall, gravity.value, gravity);
    } else {
      resetFallVelocity(entity);
      gravity.cancelPendingJumps();
    }
  }



/**
 * Applies gravity effects to an entity.
 * Adjusts fall acceleration and knockback—using a faster descent,
 * minimal slow falling effect, and special handling (bounce) when landing on slime blocks.
 * @param {any} entity - The entity.
 * @param {Object} vector - The computed gravity vector.
 * @param {number} currentFall - The current fall velocity.
 * @param {number} gravityValue - The gravity value.
 * @param {Gravity} gravity - The Gravity instance (for fall distance calculations).
 */
async function applyGravityEffects(entity, vector, currentFall, gravityValue, gravity) {
    // Determine acceleration factor based on block below.
    const blockBelow = getBlockBelow(entity);
    let fallAccelerationFactor;
    
    if (blockBelow && blockBelow.typeId === "minecraft:slime_block") {
      // On slime blocks, check if we should bounce.
      if (currentFall < -1) { // if falling fast enough, bounce!
        const bounceFactor = 0.8; // energy retention factor
        const bounceImpulse = Math.abs(currentFall) * bounceFactor;
        // Invert fall velocity: set upward velocity.
        fallVelocity.set(entity, bounceImpulse);
        
        // Apply upward knockback impulse to simulate bounce.
        if (typeof entity.applyKnockback === "function") {
          entity.applyKnockback(0, 0, 0, bounceImpulse);
        }
        
        // Optionally, you can add bounce sound/particle effects here.
        return; // Skip further processing to allow the bounce to take effect.
      } else {
        // Otherwise, use gentler acceleration on slime blocks.
        fallAccelerationFactor = gravityValue / 12;
      }
    } else {
      // Normal acceleration for non-slime blocks.
      fallAccelerationFactor = gravityValue / 6;
    }
    
    // Reduce knockback during falling (minimal horizontal impulse).
    const fallModifier = Math.min(0, Number(currentFall));
    const knockbackPower = (Number(vector.y) * 1 + fallModifier) / 300;
    
    if (typeof entity.applyKnockback === "function") {
      entity.applyKnockback(
        Number(vector.x),
        Number(vector.z),
        Number(vector.hzPower),
        Number(knockbackPower)
      );
    }
    
    // Increase fall velocity faster.
    fallVelocity.set(entity, Number(currentFall) - fallAccelerationFactor);
    
    if (typeof entity.setDynamicProperty === "function") {
      const startY = Number(jumpStartY.get(entity)) || 0;
      const currentY = Number(entity.location && entity.location.y) || 0;
      const fallDist = Math.max(0, startY - currentY);
      entity.setDynamicProperty("fall_distance", fallDist);
    }
    
    // Apply a minimal slow falling effect so descent remains fast.
    const slowFallingAmplifier = 0;
    const slowFallingDuration = 1;
    
    try {
      await delay(1);
      if (entity.isValid() && typeof entity.addEffect === "function") {
        entity.addEffect("slow_falling", slowFallingDuration, {
          amplifier: slowFallingAmplifier,
          showParticles: false
        });
      }
    } catch (err) {
      console.error("Error applying gravity effects:", err);
    }
  }
  

/**
 * Resets the fall velocity for an entity.
 * @param {any} entity - The entity.
 */
function resetFallVelocity(entity) {
  fallVelocity.set(entity, 0);
}

/**
 * Sums two vector-like objects.
 * @param {Object} obj - The first vector.
 * @param {Object} [vec={x:0,y:0,z:0}] - The second vector.
 * @param {number} [multi=1] - A multiplier.
 * @return {Object} The summed vector.
 */
function sumObjects(obj, vec = { x: 0, y: 0, z: 0 }, multi = 1) {
  return {
    x: (Number(obj.x) || 0) + (Number(vec.x) || 0) * multi,
    y: (Number(obj.y) || 0) + (Number(vec.y) || 0) * multi,
    z: (Number(obj.z) || 0) + (Number(vec.z) || 0) * multi
  };
}

/**
 * Converts a rotation object to a directional vector.
 * @param {Object} rotation - The rotation object.
 * @return {Object} The direction vector.
 */
function getDirectionFromRotation(rotation) {
  const radY = (Number(rotation.y) + 90) * (Math.PI / 180);
  const radX = (Number(rotation.x) + 90) * (Math.PI / 180);
  return {
    x: Math.cos(radY),
    y: Math.cos(radX),
    z: Math.sin(radY)
  };
}

/**
 * Returns a promise that resolves after a specified number of ticks.
 * @param {number} ticks - The number of ticks.
 * @return {Promise<void>} A promise that resolves after the delay.
 */
function delay(ticks) {
  return new Promise(resolve => {
    system.runTimeout(resolve, ticks * 20);
  });
}

/**
 * Processes gravity for all entities in all dimensions.
 */
system.runInterval(() => {
  const dimensions = DimensionTypes.getAll().map(type => world.getDimension(type.typeId));
  dimensions.forEach(dimension => {
    const entities = dimension.getEntities({});
    entities.forEach(entity => {
      gravityFuncMain(entity);
    });
  });
});

/**
 * Mace Damage System:
 * When an entity is hit, if the damaging entity is a player holding a mace,
 * extra damage is applied based on the fall distance.
 * - Minimum fall distance: 1.5 blocks.
 * - For the first 3 blocks beyond 1.5: +4 hearts per block (8 damage per block).
 * - For the next 5 blocks: +2 damage per block.
 * - Beyond that: +1 damage per block.
 * Visual feedback is provided.
 */
world.afterEvents.entityHitEntity.subscribe(event => {
  const { damagingEntity, hitEntity } = event;
  if (damagingEntity && damagingEntity.typeId === "minecraft:player") {
    const invComp = damagingEntity.getComponent("minecraft:inventory");
    const container = invComp && invComp.container;
    if (container) {
      const selectedItem = container.getItem(damagingEntity.selectedSlot);
      if (selectedItem && selectedItem.typeId === "minecraft:mace") {
        const fallDistance = Number(damagingEntity.getDynamicProperty("fall_distance")) || 0;
        let extraDamage = 0;
        if (fallDistance >= 1.5) {
          const extraFall = fallDistance - 1.5;
          const firstSegment = Math.min(extraFall, 3);
          extraDamage += firstSegment * 8;
          const secondSegment = Math.max(0, Math.min(extraFall - 3, 5));
          extraDamage += secondSegment * 2;
          const thirdSegment = Math.max(0, extraFall - 8);
          extraDamage += thirdSegment * 1;
        }
        if (typeof hitEntity.applyDamage === "function") {
          hitEntity.applyDamage(extraDamage);
        }
        if (typeof damagingEntity.setDynamicProperty === "function") {
          damagingEntity.setDynamicProperty("fall_distance", 0);
        }
        if (typeof hitEntity.playAnimation === "function") {
          hitEntity.playAnimation("animation.hurt");
        }
        if (typeof damagingEntity.playSound === "function") {
          damagingEntity.playSound("random.orb");
        }
      }
    }
  }
});

/**
 * Gets the block above the entity's head.
 * @param {any} entity - The entity.
 * @return {any|null} The block above the entity or null if unavailable.
 */
function getBlockAbove(entity) {
  if (entity.dimension && typeof entity.dimension.getBlock === "function") {
    const x = Math.floor(entity.location.x);
    const y = Math.floor(entity.location.y + 1.8); // entity's height is ~1.8 blocks
    const z = Math.floor(entity.location.z);
    return entity.dimension.getBlock({ x, y, z });
  }
  return null;
}

/**
 * Gets the block in the direction the entity is moving.
 * Validates that location and movement vector values are numbers.
 * @param {any} entity - The entity.
 * @return {any|null} The block in the movement direction or null if unavailable.
 */
function getBlockInMovementDirection(entity) {
  if (
    !entity.location ||
    typeof entity.location.x !== "number" ||
    typeof entity.location.y !== "number" ||
    typeof entity.location.z !== "number"
  ) {
    return null;
  }
  if (typeof entity.inputInfo?.getMovementVector !== "function") return null;
  const movement = entity.inputInfo.getMovementVector();
  if (
    typeof movement.x !== "number" ||
    typeof movement.y !== "number" ||
    typeof movement.z !== "number"
  ) {
    return null;
  }
  const magnitude = Math.sqrt(movement.x ** 2 + movement.y ** 2 + movement.z ** 2);
  if (magnitude === 0) return null;
  
  // Normalize the movement vector.
  const direction = {
    x: movement.x / magnitude,
    y: movement.y / magnitude,
    z: movement.z / magnitude
  };
  
  // Check one block ahead in the direction of movement.
  const checkDistance = 1;
  const pos = {
    x: Math.floor(entity.location.x + direction.x * checkDistance),
    y: Math.floor(entity.location.y + direction.y * checkDistance),
    z: Math.floor(entity.location.z + direction.z * checkDistance)
  };
  
  if (entity.dimension && typeof entity.dimension.getBlock === "function") {
    return entity.dimension.getBlock(pos);
  }
  return null;
}

/**
 * Gets the block at an offset from the entity's location.
 * Ensures that the entity's location values are valid numbers.
 * @param {any} entity - The entity.
 * @param {number} offsetX - Offset on the X axis.
 * @param {number} offsetY - Offset on the Y axis.
 * @param {number} offsetZ - Offset on the Z axis.
 * @return {any|null} The block at the offset or null if unavailable.
 */
function getBlockAtOffset(entity, offsetX, offsetY, offsetZ) {
    if (!entity.location ||
        typeof entity.location.x !== "number" || isNaN(entity.location.x) ||
        typeof entity.location.y !== "number" || isNaN(entity.location.y) ||
        typeof entity.location.z !== "number" || isNaN(entity.location.z)) {
      return null;
    }
    const pos = {
      x: Math.floor(entity.location.x + offsetX),
      y: Math.floor(entity.location.y + offsetY),
      z: Math.floor(entity.location.z + offsetZ)
    };
    if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) return null;
    if (entity.dimension && typeof entity.dimension.getBlock === "function") {
      return entity.dimension.getBlock(pos);
    }
    return null;
  }
  
  /**
   * Gets the block just below the entity.
   * Ensures that the entity's location values are valid numbers.
   * @param {any} entity - The entity.
   * @return {any|null} The block below the entity or null if unavailable.
   */
  function getBlockBelow(entity) {
    if (!entity.location ||
        typeof entity.location.x !== "number" || isNaN(entity.location.x) ||
        typeof entity.location.y !== "number" || isNaN(entity.location.y) ||
        typeof entity.location.z !== "number" || isNaN(entity.location.z)) {
      return null;
    }
    const pos = {
      x: Math.floor(entity.location.x),
      y: Math.floor(entity.location.y - 0.1), // slightly below the feet
      z: Math.floor(entity.location.z)
    };
    if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) return null;
    if (entity.dimension && typeof entity.dimension.getBlock === "function") {
      return entity.dimension.getBlock(pos);
    }
    return null;
  }
 