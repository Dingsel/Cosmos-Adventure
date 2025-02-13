import { world, system, DimensionTypes } from "@minecraft/server";
export { Gravity }

/*
*Class representing gravity control for entities
*/
class Gravity {
    constructor(entity) {
        this.#entity = entity; // Store the entity reference
    }

    #entity;

    // Get the entity associated with this Gravity instance
    get entity() {
        return this.#entity;
    }

    // Get the current gravity value for the entity
    get value() {
        return this.entity.tempGravityValue || this.entity.getDynamicProperty('sert:gravity') || 9.8;
    }

    // Set a permanent gravity value for the entity
    set(value) {
        if (!this.canSet(value)) {
            throw new Error('Failed to set gravity value(' + value + ') for ' + this.entity.typeId + ' (use Gravity.canSet)');
        }
        this.#entity.setDynamicProperty('sert:gravity', value);
    }

    // Set a temporary gravity value for the entity
    setTemp(value) {
        if (!this.canSet(value)) {
            throw new Error('Failed to set gravity value(' + value + ') for ' + this.entity.typeId + ' (use Gravity.canSet)');
        }
        this.entity.tempGravityValue = value;
    }

    // Check if a gravity value can be set for the entity
    canSet(value) {
        return typeof value === 'number' && value > 0 && !isNaN(value) && value !== Infinity;
    }

    // Set the gravity line for the entity
    setGravityLine(line = [1]) {
        this.entity.gravityLine = (this.entity.gravityLine || []);
        this.entity.gravityLine = line.concat(this.entity.gravityLine.slice(line.length - 1));
    }

    // Calculate the gravity vector for the entity
    calculateGravityVector() {
        const entity = this.entity;
        const vector = { x: 0, z: 0, y: -1 };
        const power = { x: 1, z: 1, y: this.value / 2 };

        // Handle jump state transitions
        if (entity.isJumping && playerJumpMap.get(entity)) {
            playerJumpMap.set(entity, false);
            const jumpBoost = (entity.getEffect('jump_boost')?.amplifier + 1) || 0;
            const gravityMod = Math.max(0.1, (9.8 - this.value) / 10 + 1);
            const lineLength = Math.floor(18 + (9.8 - this.value));
            
            this.setGravityLine(
                Array.from({length: lineLength}, (_, i) => 
                    (lineLength - i) / 6 * -gravityMod * 5 * 
                    ((jumpBoost * 0.2) + 1) / Math.max(Math.min(1, this.value), 0.005)
                )
            );
        } else if (entity.isOnGround) {
            this.cancelPendingJumps();
            playerJumpMap.set(entity, true);
        }

        // Process gravity line
        if (entity.gravityLine?.[0] !== undefined) {
            power.y += entity.gravityLine[0];
            entity.gravityLine.shift();
        }

        // Player movement calculations
        if (entity.typeId === 'minecraft:player') {
            const movement = entity.inputInfo.getMovementVector();
            const viewDir = entity.getViewDirection();
            const rotatedDir = getDirectionFromRotation(
                sumObjects(entity.getRotation(), { y: 90 })
            );
            
            vector.x = viewDir.x * movement.y - rotatedDir.x * movement.x;
            vector.z = viewDir.z * movement.y - rotatedDir.z * movement.x;
        }

        // Calculate final forces
        return {
            x: vector.x,
            z: vector.z,
            y: power.y * vector.y,
            hzPower: this.calculateHorizontalPower(entity)
        };
    }

    // Calculate horizontal movement power
    calculateHorizontalPower(entity) {
        const speed = (entity.getEffect('speed')?.amplifier + 1) || 0;
        const slowness = (entity.getEffect('slowness')?.amplifier + 1) || 0;
        return ((speed - slowness) * 0.2 + 1) * 
               (0.18 + (entity.isSprinting ? 0.2 : 0) - 
               (entity.isSneaking ? 0.1 : 0));
    }

    // Apply knockback with resistance and mace damage
    applyKnockbackWithDamage(entity, vector, power) {
        const knockbackResistance = entity.getEffect('knockback_resistance')?.amplifier || 0;
        const resistanceFactor = 1 - Math.min(1, knockbackResistance * 0.2); // 20% reduction per level

        // Adjust knockback power based on resistance
        const adjustedPower = {
            x: vector.x * power.hzPower * resistanceFactor,
            z: vector.z * power.hzPower * resistanceFactor,
            y: vector.y * power.y * resistanceFactor
        };

        // Apply knockback
        entity.applyKnockback(adjustedPower.x, adjustedPower.z, adjustedPower.hzPower, adjustedPower.y);

            }

    // Calculate fall distance for mace damage
    calculateFallDistance() {
        const entity = this.entity;
        const startY = jumpStartY.get(entity) || entity.location.y;
        return Math.max(0, startY - entity.location.y);
    }

    // Calculate mace damage based on fall distance
    calculateMaceDamage(fallDistance) {
        const baseDamage = 6; // Base damage of the mace
        const fallDamageMultiplier = 1.5; // Damage multiplier per block fallen
        return baseDamage + Math.floor(fallDistance * fallDamageMultiplier);
    }

    // Smooth jump implementation with proper cleanup
    applyJump() {
        const entity = this.entity;
        if (!entity.isOnGround) return;

        this.cancelPendingJumps();
        jumpStartY.set(entity, entity.location.y);

        const jumpHeight = this.calculateJumpHeight();
        const initialPower = Math.sqrt(2 * this.value * jumpHeight) / 20;
        
        const executeJumpStep = (step) => {
            if (entity.isOnGround || step >= 20) {
                pendingJumpSteps.delete(entity);
                return;
            }

            const progress = Math.sin((step / 20) * Math.PI);
            entity.applyKnockback(0, 0, 0, initialPower * progress);

            const timeoutId = system.runTimeout(() => executeJumpStep(step + 1), 1);
            pendingJumpSteps.set(entity, timeoutId);
        };

        executeJumpStep(0);
    }

    cancelPendingJumps() {
        const timeoutId = pendingJumpSteps.get(this.entity);
        if (timeoutId) {
            system.clearRun(timeoutId);
            pendingJumpSteps.delete(this.entity);
        }
    }
}

// Runs gravity calculations at regular intervals for all players in the world
system.runInterval(() => {
    for (let dimension of DimensionTypes.getAll().map(type => world.getDimension(type.typeId))) {
        for (let entity of dimension.getEntities({ type: 'player' })) {
            gravityFuncMain(entity);
        }
    }
});


// Mace damage system
world.afterEvents.entityHitEntity.subscribe((event) => {
    const { damagingEntity, hitEntity } = event;
    
    if (damagingEntity?.typeId === 'minecraft:player') {
        const inventory = damagingEntity.getComponent('minecraft:inventory').container;
        const selectedItem = inventory.getItem(damagingEntity.selectedSlot);
        
        if (selectedItem?.typeId === 'minecraft:mace') {
            const fallDistance = damagingEntity.getDynamicProperty('fall_distance') || 0;
            const damage = Math.max(0, Math.floor(fallDistance * 3 - 3));
            
            hitEntity.applyDamage(damage);
            damagingEntity.setDynamicProperty('fall_distance', 0);
            
            // Visual feedback
            hitEntity.playAnimation('animation.hurt');
            damagingEntity.playSound('random.orb');
        }
    }
});

let jumpStartY = new WeakMap();
// Shared state management
const pendingJumpSteps = new WeakMap();
const playerJumpMap = new WeakMap();
const fallVelocity = new WeakMap();

// Main gravity processing
function gravityFuncMain(entity) {
    const gravity = new Gravity(entity);
    if (Math.abs(gravity.value - 9.8) < 0.0001) return;

    const vector = gravity.calculateGravityVector();
    const currentFall = fallVelocity.get(entity) || 0;

    if (!entity.isOnGround && entity.isClimbing && entity.isGliding) {
        applyGravityEffects(entity, vector, currentFall, gravity.value);
    } else {
        resetFallVelocity(entity);
        gravity.cancelPendingJumps();
    }
}

async function applyGravityEffects(entity, vector, currentFall, gravityValue) {
    const fallModifier = Math.min(0, currentFall);
    const knockbackPower = (vector.y * 2 + fallModifier) / 40;
    
    entity.applyKnockback(vector.x, vector.z, vector.hzPower, knockbackPower);
    fallVelocity.set(entity, currentFall - gravityValue / 50);

    await delay(2);
    if (entity.isValid()) {
        entity.addEffect('slow_falling', 1, { 
            amplifier: 1, 
            showParticles: false 
        });
    }
}



// Function to reset the fall velocity for the entity when on the ground
function resetFallVelocity(entity) {
    fallVelocity.set(entity, 0);
}

// Utility function to sum vector components
function sumObjects(objects, vector = undefined, multi = 1) {
    return {
        x: (objects.x || 0) + (vector.x || 0) * multi,
        y: (objects.y || 0) + (vector.y || 0) * multi,
        z: (objects.z || 0) + (vector.z || 0) * multi
    };
}

// Function to get movement direction from rotation
function getDirectionFromRotation(rotation) {
    let angle = {
        x: (rotation.y + 90) / 57.2958, // Convert degrees to radians
        y: (rotation.x + 90) / 57.2958
    };
    let point = {
        x: Math.cos(angle.x), // Calculate x component
        y: Math.cos(angle.y), // Calculate y component
        z: Math.sin(angle.x)  // Calculate z component
    };
    return point; // Return direction vector
}


 function delay(ticks) {
    return new Promise(res => system.runTimeout(res, ticks * 20));
}
