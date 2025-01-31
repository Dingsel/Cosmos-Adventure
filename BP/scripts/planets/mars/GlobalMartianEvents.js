import { PlanetEventHandler  } from "../dimension/LevelOnJoin";
import { Player, world } from "@minecraft/server";
import { Planet } from "../dimension/GalacticraftPlanets";
import { Gravity } from "../dimension/Gravity";


const planet = Planet.get('mars');
const eventHandler = new PlanetEventHandler('mars');

eventHandler.onJoinLevel((entity) => {
    // Apply gravity to all players on Mars
    planet.getPlayers().forEach(player => {
        new Gravity(player).set(planet.gravity);
    });
});