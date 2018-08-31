'use strict';

const fs = require('fs');
// префикс сообщения об ошибке
const ERR_MSG = '\x1b[31m' + 'ERR>>> ' + '\x1b[0m';
// префикс сообщения об успешном выполнении
const SCS_MSG = '\x1b[32m' + 'DONE>>> ' + '\x1b[0m';

/**
 * Конструктор приложения: перечень приватных свойств и вызов основного метода.
 * @constructor
 */
function Smarthome() {
    /**
     * Объект с выходными данными.
     * @private
     */
    this._output = {
        "schedule": {},
        "consumedEnergy": {"value": 0, "devices": {}}
    };

    /**
     * Вспомогательный объект для хранения информации о потребляемой мощности каждого устройства.
     * Ключ -- ID устройства.
     * Значение -- потребляемая мощность.
     * @type {Object}
     * @private
     */
    this._devicesPowerInfo = {};

    /**
     * Максимальное потребление мощность одним или несколькими устройствами в одно время.
     * @type {number}
     * @private
     */
    this._maxPower = 0;

    /**
     * Параметры суток.
     * @type {Object}
     * @private
     */
    this._day = {
        dayStart: 7,
        dayEnd: 21,
        nightStart: 21,
        nightEnd: 7,
        duration: 24
    };

    this.process().catch(this.errorMessage);
}

/**
 * Вывод сообщений об ошибках.
 * @param {String} errText
 */
Smarthome.prototype.errorMessage = function (errText) {
    console.log(ERR_MSG + errText);
};

/**
 * Чтение входных данных из файла, конвертация JSON s объект.
 * @returns {Promise<any>}
 * @private
 */
Smarthome.prototype.getInputData = function () {
    // Создадим промис и заполним резолв JSONом из файла
    return new Promise((resolve, reject) => {
        fs.readFile('./smarthome/input.json', (err, data) => {
            // ошибка чтения файла
            if (err) reject(err);
            // проверим, что строка -- это JSON
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                reject('invalid json');
            }
        });
    });
};

/**
 * Запись выходных данных в файл.
 */
Smarthome.prototype.saveOutputdData = function () {
    // Создадим промис с записью данных в файл
    return new Promise((resolve, reject) => {
        // путь к файлу с выходными данными
        const filePath = './smarthome/output.json';
        // конвертация объекта в JSON и форматирование JSON строки
        const output = JSON.stringify(this._output, null, '\t');
        fs.writeFile(filePath, output, 'utf8', err => {
            if (err) {
                reject(`failed to create a file '${filePath}'`);
            } else {
                resolve(console.log(SCS_MSG + `Created '${filePath}'`));
            }
        });
    })
};

/**
 * Расчитаем почасовую цену за сутки.
 * @param rates {Array}
 * @returns {Array}
 */
Smarthome.prototype.getRates = function (rates) {
    let arRates = [],
        arRatesTmp = []; // вспомогательный массив для ночных тарифов
    // Переберм тарифные периоды
    rates.forEach(period => {
        let from = period.from,
            to = period.to;
        // Если тарифный период заканчивается в текущих сутках,
        // то считаем до окончания периода, иначе -- до конца суток.
        for (let i = from; i < (from < to ? to : this._day.duration); i++) {
            arRates.push({'hour': i, 'value': period.value});
        }
        // Если тарифный период переходит на следующие сутки,
        // то добавим во вспомогательный массив "утренние" часы.
        if (from > to) {
            for (let i = 0; i < to; i++) {
                arRatesTmp.push({'hour': i, 'value': period.value});
            }
        }
        // вспомогательный массив добавляем перед основным, т.к. это "утренние" часы.
        arRates = arRatesTmp.concat(arRates);
    });

    return arRates;
};

/**
 * Расчет затрат по выбранному устройству за заданный период времени.
 * @param device {Object}
 * @param period {Array}
 * @returns {Object}
 */
Smarthome.prototype.countDevice = function (device, period) {
    let deviceOutput = {
        'id': device.id,
        'hours': [],
        'consumedEnergy': 0
    };
    // переберем часы заданного периода
    for (let i = 0; i <= period.length - 1; i++) {
        // сумма потребления эл. энергии одним или несколькими устройствами одновременно
        let commonPower = device.power;
        // если в данный час работают еще какие-то устройства,
        // добавим их потребляемую мощность к мощности проверяемого устройства
        if (this._output.schedule.hasOwnProperty(period[i].hour)) {
            this._output.schedule[period[i].hour].forEach(deviceID => {
                commonPower += this._devicesPowerInfo[deviceID];
            })
        }
        // если общая потребляемая мощность больше максимальной, вернем пустой объект...
        if (commonPower > this._maxPower) return {};
        // ... иначе добавим текущий час к массиву часов работы устройства
        deviceOutput.hours.push(period[i].hour);
        // затраты на работу устройства в текущий час
        deviceOutput.consumedEnergy += device.power / 1000 * period[i].value;
    }

    return deviceOutput;
};

/**
 * Обновляет выходные данные.
 * @param deviceOutput {Object}
 */
Smarthome.prototype.updateOutput = function (deviceOutput) {
    // переберем часы работы устройства
    deviceOutput.hours.forEach(hour => {
        // если у объекта _output.schedule нет свойства с номером часа, создадим его
        if (!this._output.schedule.hasOwnProperty(hour)) {
            this._output.schedule[hour] = [];
        }
        // добавим в расписание работу устройства в текущем часу
        this._output.schedule[hour].push(deviceOutput.id);
    });
    // если у объекта _output.consumedEnergy.devices нет свойства с id устройства, создадим его
    if (!this._output.consumedEnergy.devices.hasOwnProperty(deviceOutput.id)) {
        this._output.consumedEnergy.devices[deviceOutput.id] = 0;
    }
    // обновим общие затраты на электроэнергию для всех устройств
    this._output.consumedEnergy.value += deviceOutput.consumedEnergy;
    // добавим затраты на электроэнергию для этого устройства
    this._output.consumedEnergy.devices[deviceOutput.id] = deviceOutput.consumedEnergy;
};

/**
 * Обработка входных данных и запись результата.
 * @returns {Promise<any | never>}
 */
Smarthome.prototype.process = function () {
    return this.getInputData()
        // После получения данных из файла
        .then(data => {
            // тарифы
            let rates = this.getRates(data.rates);
            // максимальная мощность
            this._maxPower = data.maxPower;

            data.devices.forEach(device => {
                // выходная информация о работе устройства
                let deviceOutput = {};

                /**
                 * Расчет времени и затрат на работу устройства в заданный период суток.
                 * @param from {Number} начало периода работы
                 * @param to {Number} конец периода работы
                 */
                const getDeviceOutput = (from, to) => {
                    for (let i = from; i + device.duration < to; i++) {
                        // рассчитаем затраты на работу устройства в заддынный период
                        let tmpDeviceOutput = this.countDevice(device, rates.slice(i, i + device.duration));
                        // если расчет был выполнен и текущая расчетная цена ниже предыдущей,
                        // запишем результат в выходную информацию о работе устройства
                        if (Object.keys(tmpDeviceOutput).length !== 0
                            && (Object.keys(deviceOutput).length === 0 || tmpDeviceOutput.consumedEnergy < deviceOutput.consumedEnergy)) {
                            deviceOutput = tmpDeviceOutput;
                        }
                    }
                };

                // добавим информацию о потребляемой мощности устройства во вспомогательный объект
                this._devicesPowerInfo[device.id] = device.power;

                if (device.mode === 'day') {
                    // если устройство работает только днем, периодом для расчета его работы будет начало и конец дня
                    getDeviceOutput(this._day.dayStart, this._day.dayEnd);
                } else if (device.mode === 'night') {
                    // если устройство работает только ночью, рассчитаем работу устройства с начала ночи и до полуночи...
                    getDeviceOutput(this._day.nightStart, this._day.duration);
                    // ... и с полуночи до конца ночи
                    getDeviceOutput(0, this._day.nightEnd);
                } else if (device.duration !== this._day.duration) {
                    // если время работы устройства не 24 часа
                    getDeviceOutput(0, this._day.duration);
                } else {
                    // если устройство работает круглосуточно
                    deviceOutput = this.countDevice(device, rates);
                }
                // если для устройства был произведен расчет его работы, обновим выходные данные
                if (Object.keys(deviceOutput).length !== 0) {
                    this.updateOutput(deviceOutput);
                }
            });
        })
        // запись выходных данных в файл
        .then(() => this.saveOutputdData());
};

/**
 * Создаем экземпляр Smarthome для запуска из командной строки.
 */
new Smarthome();
