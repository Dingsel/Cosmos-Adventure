import { PlanetEventHandler  } from "../dimension/LevelOnJoin";
import { Player, world } from "@minecraft/server";
import { Planet } from "../dimension/GalacticraftPlanets";
import { Gravity } from "../dimension/Gravity";
import { CoordinateManager } from "../../api/world/DimensionalCoord";

const mars = Planet.get('mars');
const eventHandler = new PlanetEventHandler('mars');

eventHandler.onJoinLevel((player) => {
    // Create an instance of CoordinateManager for the player
    const coordinateManager = new CoordinateManager(player);
    
    // Get the player's current location
    const currentLocation = player.location;
    
    // Check if the player is not already on Mars
    if (!mars.isOnPlanet(currentLocation)) {
        // Set the player's coordinates to Mars' center
        coordinateManager.setPlayerCoordinates('mars');
    }

    // Apply gravity to the player on Mars
    new Gravity(player).set(mars.gravity);
});