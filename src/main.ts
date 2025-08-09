import * as utils from '@iobroker/adapter-core'
import {AutoStromDevice, isAnalog, BaseDevice, AnalogDevice, DigitalDevice, PowerCalcMode, isDigital} from './AutoStromModels'

class AutoStrom extends utils.Adapter {
  readonly AVAILABLE_POWER_IDS = ['auto_strom.0.verbrauch_aktuell',
    'auto_strom.0.verbrauch_l1',
    'auto_strom.0.verbrauch_l2',
    'auto_strom.0.verbrauch_l3'];
  readonly ERZEUGUNG_ID = 'auto_strom.0.erzeugung_aktuell'
  readonly AUTO_SUFFIX = '_AUTO';
  readonly USED_POWER_ID = 'USED_POWER';
  readonly ERZEUGER_TIMEOUT = 12; // in sek; so lange darf erstmal kein neuer Erzeuger geschaltet werden.

  delay_dict:Record<string, number> = {};
  global_devices:AutoStromDevice[] = [];
  NULL_OFFSET = 0;
  WINTER_MODUS = false; // Im winter sollen analoge (Heizung) bevorzugt geregelt werden, im Sommer nicht
  erzeuger_wait_until = 0;
  mainTimeout = 0; // main interval for clearing below

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: 'auto_strom',
    })
    this.on('ready', this.onReady.bind(this))
    this.on('stateChange', this.onStateChange.bind(this))
    this.on('unload', this.onUnload.bind(this))
  }

  private async onReady(): Promise<void> {
    // Initialize your adapter here
    this.initDevices()
    this.NULL_OFFSET = -(this.getAsNumber(this.config.null_offset) || 0)
    this.WINTER_MODUS = Boolean(this.config.winter_mode)
    this.log.info('Null offset ist: ' + this.NULL_OFFSET)
    this.log.info('Winter mode is: ' + (this.WINTER_MODUS ? 'enabled' : 'disabled'))

    this.global_devices.forEach((device) => {
      const autoId = this.createAutoState(device.id)
      this.subscribeStates(autoId)
    })
    this.createPowerUsageState()
    this.checkForNewPower()
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    if (!state) {
      return
    } else if (id.startsWith('auto_strom.')) {
      // ack state for all of our variables that are user set
      if (!state.ack) return this.setState(id, state.val as boolean, true)
    } else {
      this.log.warn(`Unknown subscribed state: ${id}`)
    }
  }

  private createAutoState(id:string):string {
    this.log.silly('Creating auto state for ' + id)
    const autoId = id + this.AUTO_SUFFIX
    this.setObjectAsync(autoId, {
      type: 'state',
      common: {
        name: 'Automatik für ' + id,
        type: 'boolean',
        role: 'value',
        read: true,
        write: true
      },
      native: {}
    })
    return autoId
  }

  private createPowerUsageState():void {
    this.setObjectAsync(this.USED_POWER_ID, {
      type: 'state',
      common: {
        name: 'Von diesem Adapter genutzte Energie (Schätzung!)',
        desc: 'Diese wird bei zusätzlichem Verbrauch automatisch zur Verfügung gestellt',
        type: 'number',
        role: 'value',
        unit: 'kW',
        read: true,
        write: true
      },
      native: {}
    })
    this.setObjectAsync(this.USED_POWER_ID + '_DIGITAL_VERBRAUCHER', {
      type: 'state',
      common: {
        name: 'Von digitalen Verbraucher genutzte Energie',
        type: 'number',
        role: 'value',
        unit: 'W',
        read: true,
        write: true
      },
      native: {}
    })
    this.setObjectAsync(this.USED_POWER_ID + '_ERZEUGER', {
      type: 'state',
      common: {
        name: 'Von Erzeuger genutzte Energie',
        type: 'number',
        role: 'value',
        unit: 'W',
        read: true,
        write: true
      },
      native: {}
    })
    this.setObjectAsync(this.USED_POWER_ID + '_ANALOG', {
      type: 'state',
      common: {
        name: 'Von analogen genutzte Energie',
        type: 'number',
        role: 'value',
        unit: 'W',
        read: true,
        write: true
      },
      native: {}
    })
  }

  private initDevices():void {
    this.config.devices.forEach((device) => {
      const phasen = []
      if (device.l1) {
        phasen.push(1)
      }
      if (device.l2) {
        phasen.push(2)
      }
      if (device.l3) {
        phasen.push(3)
      }
      if (phasen.length = 0) {
        phasen.push(0)
      }
      const newBaseDevice:BaseDevice = {
        id: device.id,
        // eslint-disable-next-line eqeqeq
        erzeuger: !!device.erzeuger,
        priority: Number(device.priority),
        verbrauch: Number(device.verbrauch),
        delay_ms: (typeof device.delay === 'number' && device.delay > 0) ? Number(device.delay) * 1000 : 0,
        // eslint-disable-next-line eqeqeq
        analog: (!device.erzeuger && !!device.analog),
        phasen: phasen
      }
      if (isAnalog(newBaseDevice)) {
        newBaseDevice.analog_max = this.getAsNumber(device.analog_max) || 100
        newBaseDevice.analog_min = this.getAsNumber(device.analog_min) || 0
        newBaseDevice.value = 0
        this.global_devices.push(newBaseDevice)
      }
      if (isDigital(newBaseDevice)) {
        newBaseDevice.value = false
        this.global_devices.push(newBaseDevice)
      }
    })
  }

  private async fetchDeviceState(devices:AutoStromDevice[]):Promise<AutoStromDevice[]> {
    const devicesToReturn: AutoStromDevice[] = []
    for (const device of devices) {
      try {
        // Get the automatic mode bool value
        const autoState = await this.getStateAsync(device.id + this.AUTO_SUFFIX)
        // eslint-disable-next-line eqeqeq
        if (autoState != null && !autoState.val) continue
      } catch (err) {
        this.log.error('Loading Auto state for ' + device.id + ' gave the followíng error: ' + err)
        continue
      }
      try {
        // Get the automatic mode bool value
        const state = await this.getForeignStateAsync(device.id)
        // eslint-disable-next-line eqeqeq
        if (state == null) continue
        device.value = state.val as (number|boolean) // fixme
      } catch (err) {
        this.log.warn('State ' + device.id + ' is not set or does not exist, ignoring it. Error is: ' + err)
        continue
      }
      const aliveId = device.id.substr(0, device.id.lastIndexOf('.') + 1) + 'alive'
      try {
        // Get the alive state
        const aliveState = await this.getForeignStateAsync(aliveId)
        // eslint-disable-next-line eqeqeq
        if (aliveState == null) throw new Error('state is null')
        if (!aliveState.val) {
          // Device not alive, remove it
          this.log.silly('Device ' + device.id + ' is not alive, ignoring.')
          continue
        }
      } catch (err) {
        this.log.silly('Alive state for' + device.id + ' is not set or does not exist, ignoring it. ' + err)
        // continue // todo shelly?
      }
      // Everything successful
      devicesToReturn.push(device)
    }
    return devicesToReturn
  }


  private async checkForNewPower(): Promise<void> {
    // check that power is being produced first, else exit
    if ((await this.getStateAsync(this.ERZEUGUNG_ID))?.val as number <= 0) {
      this.mainTimeout = this.setTimeout(this.checkForNewPower.bind(this), 1000)
      return
    }

    const powerPerPhase:Record<string, number> = {}
    for (let i = 1; i<=3; i++) {
      powerPerPhase[i] = (await this.getStateAsync(this.AVAILABLE_POWER_IDS[i]))?.val as number
    }
    const total_available = powerPerPhase[1] + powerPerPhase[2] + powerPerPhase[3] - this.NULL_OFFSET

    if (Math.abs(total_available) < 70) {
      this.log.silly('Diff too small, trying again later')
      this.mainTimeout = this.setTimeout(this.checkForNewPower.bind(this), 300)
      return
    }

    this.log.debug('------------ ' + total_available + 'W ('+ (total_available > 0 ? 'unter null' : 'über null') + ') ------------')
    const sorted_devices = this.global_devices.slice().sort((a, b) => {
      const better_priority = total_available > 0 ? (a.priority > b.priority) : a.priority < b.priority
      return a.priority === b.priority ? 0 : +(better_priority) || -1
    })
    const next_call_time = await this.startIteratingDevices(sorted_devices, powerPerPhase)
    this.mainTimeout = this.setTimeout(this.checkForNewPower.bind(this), next_call_time)
  }

  private async startIteratingDevices(devices:AutoStromDevice[], powerPerPhase:Record<string, number>): Promise<number> {
    // Erst devices asychron preloaden, um danach Logik sychnron durchgehen zu können
    const fetchedDevices = await this.fetchDeviceState(devices)
    const digital_devices = fetchedDevices.filter(function(itm) {
      return !isAnalog(itm)
    }) as DigitalDevice[]
    const analog_devices = fetchedDevices.filter(function(itm) {
      return isAnalog(itm)
    }) as AnalogDevice[]

    const changedPower = this.setDevices(digital_devices, analog_devices, powerPerPhase)

    // Je nachdem wieviel geändert wurde, wird unterschiedlich lange gewartet,
    // um ein Oszillieren durch die Trägheit zu vermeiden
    let next_call_time: number
    if (changedPower === 0) next_call_time = 500
    else if (changedPower < 150) next_call_time = 1500
    else if (changedPower < 1000) next_call_time = 2500
    else next_call_time = changedPower * 0.6 + 2000
    if (next_call_time > 6000) next_call_time = 6000
    this.log.debug('-> FERTIG, geändert: ' + changedPower + 'W, warten für mind. ' + Math.round(next_call_time/100)/10 + 's.')
    this.updateUsedPower(fetchedDevices)
    return next_call_time
  }

  private setDevices(digital_devices:DigitalDevice[], analog_devices:AnalogDevice[], powerPerPhase:Record<string, number>):number {
    let available_power = powerPerPhase[1] + powerPerPhase[2] + powerPerPhase[3] - this.NULL_OFFSET // fixme
    const mode_under_null = available_power >= 0
    // const mode_under_null = powerPerPhase.every((el) => el >= 0)
    let changed = 0

    if (!mode_under_null) {
      // Wenn modus zu wenig, dann nicht jedes mal komplett runterregeln (gegen oszillieren)
      // fixme powerPerPhase = powerPerPhase.map((el) => Math.round(el * 0.8))
      available_power = Math.round(available_power * 0.8)
    }

    for (let i = 0; i < digital_devices.length; i++) {
      const result = this.changeDigital(digital_devices[i], available_power, mode_under_null, analog_devices)
      if (result === false) break
      if (result === 0) {
        if (i === digital_devices.length-1) this.log.debug('! Digital bereits alle im richtigen Modus!')
        continue
      }

      // available_power auf den neuen Wert ändern und speichern, wieviel geändert wurde
      available_power += result as number
      changed += Math.abs(result as number)

      if (mode_under_null ? available_power < 0 : available_power > 0) {
        this.log.debug('0 wurde überschritten durch digitalen, d.h. jetzt kompensieren mit analog')
        break
      }
    }

    /* Durch analoge iterieren */
    this.log.debug('(ANALOG) ' + available_power + 'W müssen geschaltet werden')
    for (let j = 0; j < analog_devices.length; j++) {
      const result = this.changeAnalog(analog_devices[j], available_power)
      if (result === 0) {
        if (j === analog_devices.length - 1) {
          if (changed === 0 && mode_under_null) {
            this.log.info('!! Es wird eingespeist und es kann nicht mehr geregelt werden, da alle Verbraucher bereits voll an und alle Erzeuger aus sind')
          } else {
            this.log.debug('! Analog bereits alle im richtigen Modus')
          }
        }
        continue
      }


      changed += Math.abs(result)
      available_power -= result
      if (Math.abs(available_power) < 200) break // analog hat fertig geregelt, kein nächster durchlauf
    }

    return changed
  }


  private changeDigital(device:DigitalDevice, available_power: number, mode_under_null: boolean, analog_devices:AnalogDevice[]) : number|boolean {
    const log_name = (device.erzeuger ? 'Erzeuger' : 'Verbraucher') + ' (' + device.id + ')'
    const now = new Date().getTime()

    const new_mode = device.erzeuger ? !mode_under_null : mode_under_null
    // eslint-disable-next-line eqeqeq
    if (device.value == new_mode) {
      // Digitales Gerät, das schon im richtigen Modus ist
      return 0
    }

    // Schaltverzögerung überprüfen
    if (device.delay_ms > 0 && this.delay_dict[device.id] !== undefined && this.delay_dict[device.id] > now) {
      if (device.erzeuger && !mode_under_null) {
        // EINschaltverzögerung bei Erzeugern ignorieren
      } else {
        this.log.debug(log_name + ' wird nicht geschaltet, da es noch Schaltverzögerung von ' +
        (this.delay_dict[device.id] - now) / 1000 + 's hat, continue')
        return -1 // workaround, damit nicht alle im richtigen modus erkannt werden
      }
    }

    if (this.shouldAnalogBeUsed(device, available_power, mode_under_null, log_name, analog_devices)) {
      return false
    }

    // Globale Erzeuger-AUSschaltverzögerung (da diese Delays haben und ungenau sind) überprüfen
    if (device.erzeuger && mode_under_null && now < this.erzeuger_wait_until) {
      this.log.debug('Erzeuger wird noch nicht AUSgeschaltet, da gerade erst einer geschaltet wurde')
      return -1 // workaround, damit nicht alle im richtigen modus erkannt werden
    }

    /* ------------ Ab hier ist klar, dass das digitale Device geschaltet wird --------------*/

    // Device-spezifische Schaltverzögerung setzen
    if (device.delay_ms > 0) {
      this.delay_dict[device.id] = now + device.delay_ms
    }

    // Globale Erzeuger-Schaltverzögerung setzen
    if (device.erzeuger) this.erzeuger_wait_until = now + this.ERZEUGER_TIMEOUT * 1000

    if (mode_under_null) this.log.info('Zu viel Erzeugung da, ' + log_name + ' wird geregelt (Verbraucher an, Erzeuger aus)')
    else this.log.info('Zu wenig Erzeugung da, ' + log_name + ' wird geregelt (Verbraucher aus, Erzeuger an)')
    this.setForeignState(device.id, new_mode)
    return device.verbrauch * (mode_under_null ? -1 : 1) * (device.erzeuger ? 1.2 : 1)
  }


  private changeAnalog(analog_device:AnalogDevice, available_power: number) : number {
    const old_percentage = Number(analog_device.value)

    const additional_percent = (available_power * 100 / analog_device.verbrauch)

    // Runden, da nur ganzzahlige Prozente gesetzt werden können.
    // Abrunden ist vorteilhafter, da in beiden Fällen man damit nicht übers Limit kommt
    let new_percentage = Math.floor((old_percentage + additional_percent))

    // Falls das Gerät über seine Grenzen ist, diese einfach setzen
    if (new_percentage < analog_device.analog_min) new_percentage = analog_device.analog_min
    if (new_percentage > analog_device.analog_max) new_percentage = analog_device.analog_max
    if (new_percentage === old_percentage) {
      // Ist bereits gesetzt, abbrechen damit nicht unnötig geloggt wird
      this.log.silly(analog_device.id + ' bereits richtig gesetzt')
      return 0
    }
    if (isNaN(new_percentage)) {
      this.log.error('Sollte niemals passieren: Analoger Verbraucher kann nicht auf ' + new_percentage +
          ' gesetzt werden, da es keine Zahl ist?')
      return 0
    }

    // Berechneten Wert setzen
    this.setForeignState(analog_device.id, new_percentage)

    const added_power = (analog_device.verbrauch * (new_percentage - old_percentage) / 100)
    this.log.debug(analog_device.id + ' auf ' + new_percentage + '%, was ' + added_power + 'W mehr sind.')

    return added_power
  }

  private shouldAnalogBeUsed(device:AutoStromDevice, available_power:number, mode_under_null:boolean,
    log_name:string, analog_devices:AnalogDevice[]):boolean {
    const consumable_from_analog = this.calculateAnalogPower(analog_devices, PowerCalcMode.ADDITIONAL_CONSUMABLE)
    const freeable_from_analog = this.calculateAnalogPower(analog_devices, PowerCalcMode.ADDITIONAL_FREEABLE)
    const total_analog = this.calculateAnalogPower(analog_devices, PowerCalcMode.TOTAL_ANALOG_POWER)

    if (mode_under_null && consumable_from_analog > available_power) {
      if (this.WINTER_MODUS || device.erzeuger) {
        // Zuviel Erzeugung vorhanden, im Winter nachregeln solange mit analogem, bis dieser 100% überschreiten würde
        // Außerdem immer erst analogen hochschalten bevor erzeuger aus
        this.log.debug('Die zu viele Erzeugung kann durch Nachregeln von analog ausgeglichen werden, break (winter mode oder erzeuger)')
        return true
      }
    }

    if (!mode_under_null) {
      // Berechnen, auf wieviel Prozent die analogen vom Gesamtwert gestellt werden *müssten*
      // Beispiel: wenn analog bei ca. 90 % aktuell: (6000 gesamt - 1200 noch frei - 600 muss nachregeln) / 6000 ==> auf 70 % stellen)
      const new_percent_analog =
        (total_analog - consumable_from_analog - Math.abs(available_power)) / (total_analog + 0.001) // div by 0 avoided
      let percent_cutoff
      if (this.WINTER_MODUS) {
        // Im Winter lieber digitale ausschalten als Heizung runterregeln
        // Könnte auch auf 1 gesetzt werden, aber so werden etwas seltener die Relays beansprucht
        percent_cutoff = device.erzeuger ? 0.92 : 0.7
      } else {
        // Im Sommer mit analogen (Heizung wird eh warm) regeln, da genauer (Erzeuger trotzdem bevorzugt wieder an)
        // verbraucher nicht größer 0 setzen, da sonst oszillierren: Verbraucher werden dann deswegen direkt wieder ausgestellt,
        // wenn sie vorher bei verfügbaren Strom angestellt wurden),
        // da beim anstellen dieser Offset nicht bekannt war (im Wintermodus ist das nicht der Fall)
        percent_cutoff = device.erzeuger ? 0.7 : 0
      }

      if (new_percent_analog > percent_cutoff) {
        this.log.debug('Modus zu wenig: Erstmal analog runterregeln, da dieser noch hoch genug ist, break')
        return true
      }
    }

    // Berechnen wieviel wir durch digitalen maximal schalten können (ohne dass dieser insgesamt die Linie überschreitet)
    // Also: verfügbaren strom + kompensierbar durch analog - ein offset gegen togglen
    let max_compensable = Math.abs(available_power)
    // Addieren, was vom analogen wieder in die andere Richtung geschaltet werden kann. Insgesamt wird die Zahl positiv größer.
    max_compensable += mode_under_null ? freeable_from_analog : consumable_from_analog
    max_compensable -= (device.verbrauch * 0.7)
    if (device.verbrauch > max_compensable) {
      if (!mode_under_null && freeable_from_analog === 0) {
        // Sonderfall: Entweder kein analoger mehr da oder Triggerwert digital sehr hoch
        // => Digitalen trzdem schalten um lieber einzuspeisen als zu beziehen
        this.log.debug('Über der Nulllinie und nichts mehr frei in analog: Digitaler wird geschaltet, um unter Nulllinie zu bleiben.')
      } else {
        this.log.debug(log_name + ' nicht geändert, da danach nicht mit analogem kompensiert werden kann. Verbrauch ' +
          device.verbrauch + 'W und max_compensable ist ' + Math.round(max_compensable) + 'W => Regeln nur mit analog oder gar nicht.')
        return true
      }
    }
    return false
  }

  private calculateAnalogPower(devices:AnalogDevice[], calculation_mode:PowerCalcMode):number {
    let additionalPower = 0
    for (const device of devices) {
      let percentage
      switch (calculation_mode) {
        case PowerCalcMode.ADDITIONAL_CONSUMABLE:
          percentage = device.analog_max - device.value
          break
        case PowerCalcMode.ADDITIONAL_FREEABLE:
          percentage = device.value - device.analog_min
          break
        case PowerCalcMode.TOTAL_ANALOG_POWER:
          percentage = device.analog_max - device.analog_min
          break
        default:
          throw Error('Modus nicht verfügbar, get good.')
      }
      additionalPower += device.verbrauch * percentage / 100
    }
    return additionalPower
  }

  private isPreferred(itm_phasen: number[], preferred: boolean[]): boolean {
    for (let i = 1; i<=3; i++) {
      if (itm_phasen.includes(i) && !preferred[i]) {
        return false
      }
    }
    return true
  }


  private updateUsedPower(devices:AutoStromDevice[]):void {
    let analogPowerUsed = 0
    let digitalVerbraucherPowerUsed = 0
    let erzeugerPowerUsed = 0
    devices.forEach((device) => {
      if (isAnalog(device)) {
        analogPowerUsed += device.verbrauch * (device.value) / 100
      } else if (!device.erzeuger && device.value) {
        digitalVerbraucherPowerUsed += device.verbrauch
      } else if (device.erzeuger && !device.value) {
        erzeugerPowerUsed += device.verbrauch
      }
    })
    this.setState(this.USED_POWER_ID + '_ANALOG', analogPowerUsed, true)
    this.setState(this.USED_POWER_ID + '_DIGITAL_VERBRAUCHER', digitalVerbraucherPowerUsed, true)
    this.setState(this.USED_POWER_ID + '_ERZEUGER', erzeugerPowerUsed, true)
    let total = (analogPowerUsed + digitalVerbraucherPowerUsed + erzeugerPowerUsed) / 100
    total = Math.round(total) / 10
    this.setState(this.USED_POWER_ID, total, true)
  }

  private getAsNumber(n:any):number|null {
    if (!isNaN(parseFloat(n))) {
      return Number(n)
    }
    return null
  }

  private onUnload(callback: () => void): void {
    try {
      clearTimeout(this.mainTimeout)
      callback()
    } catch (e) {
      callback()
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new AutoStrom(options)
} else {
  // otherwise start the instance directly
  (() => new AutoStrom())()
}
